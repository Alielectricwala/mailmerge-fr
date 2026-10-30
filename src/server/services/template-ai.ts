// AI template drafting with Google Gemini (REST generateContent, structured JSON output).
// What leaves the server: the person's brief, an optional example email they supplied, the sign-off,
// and merge-field names with coverage percentages. Contact records are never sent.
// The draft comes back to a person for review; nothing is saved or sent automatically.
import { z } from "zod";
import prisma from "../db.js";
import { env } from "../config.js";
import { AppError } from "../middleware/error-handler.js";
import { validateTemplate } from "../../shared/merge.js";
import {
  STANDARD_FIELD_LABELS,
  WRITER_LENGTHS,
  WRITER_TONES,
  reviewTemplateDraft,
  type TemplateDraftDto,
  type TemplateDraftRequestSchema,
  type WriterContextDto,
  type WriterField,
} from "../../shared/template-writer.js";

type DraftInput = z.output<typeof TemplateDraftRequestSchema>;

// ---------------------------------------------------------------------------
// What the workspace can personalize with
// ---------------------------------------------------------------------------

let cachedWriterFields: { data: { totalContacts: number; fields: WriterField[] }; expiresAt: number } | null = null;
const WRITER_FIELDS_CACHE_TTL_MS = 60_000;

export function invalidateWriterFieldsCache(): void {
  cachedWriterFields = null;
}

export async function writerFields(): Promise<{ totalContacts: number; fields: WriterField[] }> {
  const now = Date.now();
  if (cachedWriterFields && cachedWriterFields.expiresAt > now) {
    return cachedWriterFields.data;
  }

  const [counts] = await prisma.$queryRaw<{ total: bigint; firstName: bigint; lastName: bigint; company: bigint; title: bigint; phone: bigint }[]>`
    SELECT COUNT(*) AS total,
      COUNT(NULLIF(TRIM("firstName"), '')) AS "firstName",
      COUNT(NULLIF(TRIM("lastName"), '')) AS "lastName",
      COUNT(NULLIF(TRIM(company), '')) AS company,
      COUNT(NULLIF(TRIM(title), '')) AS title,
      COUNT(NULLIF(TRIM(phone), '')) AS phone
    FROM contacts`;
  const custom = await prisma.$queryRaw<{ key: string; count: bigint }[]>`
    SELECT key, COUNT(*) AS count FROM contacts, jsonb_each_text("customFields") AS kv(key, value)
    WHERE TRIM(value) <> '' GROUP BY key ORDER BY count DESC, key LIMIT 60`;

  const total = Number(counts?.total ?? 0);
  const share = (n: bigint | number | undefined) => (total ? Math.min(1, Number(n ?? 0) / total) : 0);
  const standard: [string, number][] = [
    ["firstName", share(counts?.firstName)],
    ["lastName", share(counts?.lastName)],
    ["fullName", share(counts?.firstName)],
    ["email", total ? 1 : 0],
    ["company", share(counts?.company)],
    ["title", share(counts?.title)],
    ["phone", share(counts?.phone)],
  ];
  const result = {
    totalContacts: total,
    fields: [
      ...standard.map(([name, coverage]) => ({ name, label: STANDARD_FIELD_LABELS[name] ?? name, coverage, custom: false })),
      ...custom.map((c) => ({ name: c.key, label: c.key, coverage: share(c.count), custom: true })),
    ],
  };
  cachedWriterFields = { data: result, expiresAt: now + WRITER_FIELDS_CACHE_TTL_MS };
  return result;
}

export async function writerContext(): Promise<WriterContextDto> {
  const { totalContacts, fields } = await writerFields();
  return { aiEnabled: Boolean(env.GEMINI_API_KEY), model: env.GEMINI_API_KEY ? env.GEMINI_MODEL : null, totalContacts, fields };
}

// ---------------------------------------------------------------------------
// Prompt
// ---------------------------------------------------------------------------

const SYSTEM_INSTRUCTION = `You write high-converting, professional email templates for FocusRealm Mail Merge, a tool that personalizes outreach for hotel partnerships, executive networking, and co-marketing initiatives.

10 CORE PRINCIPLES OF FOCUSREALM OUTREACH:
1. Natural, conversational language: Sound like a thoughtful, real businessperson initiating a conversation, not a formal partnership proposal assembled from standard phrases. Avoid repetitive clichés like "presents an interesting opportunity to explore a complementary partnership".
2. Clear connection between companies: Naturally explain why FocusRealm is reaching out to this particular company so the reader understands immediately.
3. Meaningful partnership rationale: Explain the relationship between capabilities in simple, logical language. The proposed collaboration should follow naturally from that reasoning.
4. Concrete but exploratory tone: Give the recipient a clear idea of what working together might look like (e.g. combining an audit with an operational execution pilot), without sounding as though a fixed arrangement has already been decided. Invite discussion.
5. Strong sense of mutual value: Explain why the collaboration could be useful to both sides and, ultimately, their hotel clients. Focus on complementary strengths (e.g. guest acquisition + operational consistency).
6. Less repetition across recipients: Keep the introduction, FocusRealm/Mise Hotel explanation, call to action, and signature consistent. But the reasoning for reaching out and the potential collaboration must reflect the individual company's actual business.
7. Confident but restrained wording: Avoid excessive corporate buzzwords, grand promises, and aggressive pitches. Communicate a credible, practical possibility.
8. Natural transitions between paragraphs: Build logically: greeting -> who is reaching out on behalf of Sehej Sharma -> why reaching out -> what FocusRealm does (Mise Hotel) -> why the businesses complement each other -> concrete exploratory initiative -> low-pressure call to action.
9. Genuine personalisation: Use {{greetingLine}} or verified first name, and demonstrate understanding of their business through {{aboutCompany|whatItDoes}} and {{partnerStrength}}.
10. Consistent, low-pressure call to action: Invite a short 20-minute discussion with Sehej to explore collaboration and identify a suitable hotel for an initial pilot.

BENCHMARK REFERENCE EXAMPLE (GROWGUEST / CO-MARKETING):
"Dear {{firstName|{{company}} Team}},

I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.

We see a potential opportunity for {{company|your team}} and FocusRealm to collaborate by combining {{partnerStrength|whatItDoes|hotel marketing and direct-booking growth}} with technology that helps hotels improve operational execution and service consistency.

{{company|Your team}} focuses on {{whatItDoes|aboutCompany|hospitality marketing and guest acquisition}}. At FocusRealm, we are building Mise Hotel, a hospitality-focused Service Execution Platform that helps hotels translate SOPs and service standards into assigned tasks, track completion, and improve operational visibility and accountability.

We believe these offerings could complement each other. {{partnerComplement|While {{company|your team}} helps hotels attract guests and increase direct bookings, Mise Hotel can help them strengthen the operational processes and service standards that support the guest experience.}}

We would love to explore a joint {{initiativeHeadline|personalizationAngle|"More Bookings, Better Operations"}} initiative, combining {{partnerOffering|your core services}} with an operational execution pilot from FocusRealm. This could provide hotel clients with a more comprehensive approach to growth and service delivery.

Would you be available for a brief 20-minute discussion with Sehej to explore a potential collaboration and identify a suitable hotel for an initial pilot?

Thank you for your time. We look forward to the possibility of working together.

Founder’s Office
FocusRealm
https://misehotel.com/
https://focusrealm.org/"

Personalisation uses merge fields: {{fieldName}} or {{fieldName|fallback}} or chained fallbacks {{field1|field2|fallback}}.
- Use only fields from the list you are given, spelled exactly (case-sensitive). Never invent a field.
- Any field that not every contact has MUST have a fallback that reads naturally, e.g. "Hi {{firstName|there}}," or "teams like {{company|yours}}".
- Use personalisation where it helps; don't force every field in.

Facts: use only what the brief and the example state. Don't invent results, numbers, prices, clients, awards, dates or links. Where a detail is unknown, write around it. Never leave [placeholders].

Format: plain text body, paragraphs separated by one blank line. No HTML, no bullet symbols. Subject under 60 characters.`;

export function buildPrompt(input: DraftInput, fields: WriterField[], totalContacts: number): string {
  const fieldLines = fields
    .filter((f) => f.coverage > 0 || totalContacts === 0)
    .map((f) => `- ${f.name}: ${f.label}${totalContacts ? ` (${Math.round(f.coverage * 100)}% of contacts have it)` : ""}`)
    .join("\n");
  const defaultSignOff = "Founder’s Office\nFocusRealm\nhttps://misehotel.com/\nhttps://focusrealm.org/";
  return [
    "Write one email template.",
    `What the email should do:\n<brief>\n${input.brief}\n</brief>`,
    `Tone: ${WRITER_TONES[input.tone]}. Body length: ${WRITER_LENGTHS[input.length].words}.`,
    `Sign off with:\n${input.signOff ? input.signOff : defaultSignOff}`,
    `Merge fields available${totalContacts ? ` (${totalContacts} contacts)` : " (no contacts imported yet)"}:\n${fieldLines}`,
    input.example
      ? `Example email to learn structure and voice from. Improve on it; keep its facts but add none; only use its merge fields if they are in the list above:\n<example>\n${input.example}\n</example>`
      : "",
    'Also give the template a short internal name (2–5 words), e.g. "Hotel partnership intro".',
  ]
    .filter(Boolean)
    .join("\n\n");
}

const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Short internal name for the template, 2–5 words" },
    subject: { type: "string", description: "Subject line, may use merge fields" },
    body: { type: "string", description: "Plain-text body; paragraphs separated by a blank line" },
  },
  required: ["name", "subject", "body"],
} as const;

const OutputSchema = z.object({ name: z.string().trim().min(1).max(100), subject: z.string().trim().min(1).max(300), body: z.string().trim().min(1).max(20_000) });

// ---------------------------------------------------------------------------
// Gemini call
// ---------------------------------------------------------------------------

interface GeminiResponse {
  candidates?: { content?: { parts?: { text?: string; thought?: boolean }[] }; finishReason?: string }[];
  promptFeedback?: { blockReason?: string };
  error?: { code?: number; message?: string; status?: string };
}

const TIMEOUT_MS = 45_000;

function apiError(status: number, body: GeminiResponse | null): AppError {
  const reason = body?.error?.message ?? "";
  console.error(`[template-ai] Gemini HTTP ${status}: ${reason.slice(0, 300)}`);
  if (status === 400 && /api key/i.test(reason)) return new AppError("AI_MISCONFIGURED", "The Gemini API key was rejected. Check GEMINI_API_KEY on the server.", 503);
  if (status === 401 || status === 403) return new AppError("AI_MISCONFIGURED", "The Gemini API key isn't allowed to use this model. Check GEMINI_API_KEY and the project's access.", 503);
  if (status === 404) return new AppError("AI_MISCONFIGURED", `The model "${env.GEMINI_MODEL}" isn't available. Check GEMINI_MODEL on the server.`, 503);
  if (status === 429) return new AppError("AI_RATE_LIMITED", "Gemini's usage limit was reached. Wait a minute and try again.", 429);
  if (status >= 500) return new AppError("AI_UNAVAILABLE", "Gemini is having trouble right now. Try again in a moment.", 502);
  return new AppError("AI_FAILED", "Gemini couldn't write this draft. Try rephrasing the brief.", 502);
}

export async function draftWithGemini(
  input: DraftInput,
  ctx: { fields: WriterField[]; totalContacts: number },
  opts: { apiKey?: string; model?: string; baseUrl?: string } = {}
): Promise<TemplateDraftDto> {
  const apiKey = opts.apiKey ?? env.GEMINI_API_KEY;
  const model = opts.model ?? env.GEMINI_MODEL;
  if (!apiKey) throw new AppError("AI_DISABLED", "AI writing isn't set up on this server. Add GEMINI_API_KEY, or use a starter template.", 503);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(`${opts.baseUrl ?? env.GEMINI_BASE_URL}/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_INSTRUCTION }] },
        contents: [{ role: "user", parts: [{ text: buildPrompt(input, ctx.fields, ctx.totalContacts) }] }],
        generationConfig: { responseMimeType: "application/json", responseJsonSchema: RESPONSE_SCHEMA },
      }),
      signal: controller.signal,
    });
  } catch (err) {
    if ((err as Error).name === "AbortError") throw new AppError("AI_TIMEOUT", "Gemini took too long to answer. Try again.", 504);
    console.error("[template-ai] request failed:", (err as Error).message);
    throw new AppError("AI_UNAVAILABLE", "Couldn't reach Gemini. Check the server's internet connection and try again.", 502);
  } finally {
    clearTimeout(timer);
  }

  const body = (await res.json().catch(() => null)) as GeminiResponse | null;
  if (!res.ok) throw apiError(res.status, body);

  if (body?.promptFeedback?.blockReason) {
    throw new AppError("AI_DECLINED", "Gemini declined this brief. Rephrase it and try again.", 422, { reason: body.promptFeedback.blockReason });
  }
  const candidate = body?.candidates?.[0];
  const finish = candidate?.finishReason;
  if (finish && !["STOP", "FINISH_REASON_UNSPECIFIED"].includes(finish)) {
    const message = finish === "MAX_TOKENS" ? "The draft came out too long. Ask for a shorter email." : "Gemini stopped before finishing this draft. Rephrase the brief and try again.";
    throw new AppError("AI_DECLINED", message, 422, { reason: finish });
  }
  const text = (candidate?.content?.parts ?? [])
    .filter((p) => !p.thought && typeof p.text === "string")
    .map((p) => p.text)
    .join("");

  let parsed: z.infer<typeof OutputSchema>;
  try {
    parsed = OutputSchema.parse(JSON.parse(text));
  } catch {
    throw new AppError("AI_BAD_OUTPUT", "Gemini's answer wasn't a usable draft. Try again.", 502);
  }

  const draft = {
    name: parsed.name.replace(/^["']|["']$/g, ""),
    subject: parsed.subject.replace(/\s+/g, " "),
    body: parsed.body.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"),
  };
  const errors = validateTemplate({ subject: draft.subject, bodyHtml: draft.body });
  if (errors.length) throw new AppError("AI_BAD_OUTPUT", `The draft had a broken merge field (${errors[0]}). Try again.`, 502);

  return { ...draft, warnings: reviewTemplateDraft(draft, ctx.fields, ctx.totalContacts), source: "gemini", model };
}

/**
 * Intelligent deterministic bot drafter.
 * Follows the 10 core FocusRealm principles and the GrowGuest benchmark example.
 * Executes seamlessly when Gemini API is unavailable, unconfigured, or rate limited.
 */
export function generateBotDraft(
  input: DraftInput,
  ctx: { fields: WriterField[]; totalContacts: number }
): TemplateDraftDto {
  const has = (name: string) => ctx.fields.some((f) => f.name === name && f.coverage > 0);
  const companyField = has("company") ? "company" : ctx.fields.find((f) => f.custom && f.coverage > 0 && /company|hotel|organization/i.test(f.name))?.name || "company";
  const companyTag = `{{${companyField}|your team}}`;
  const firstTag = has("firstName") ? "{{firstName|there}}" : "there";
  const signOff = input.signOff?.trim() || "Founder’s Office\nFocusRealm\nhttps://misehotel.com/\nhttps://focusrealm.org/";

  // 1. If an example was provided (e.g. the GrowGuest benchmark or user template):
  if (input.example && input.example.trim().length > 30) {
    let body = input.example.trim();

    // Replace specific company names with dynamic merge tag
    const companyMatch = body.match(/\b(GrowGuest|Concierge Collective|RevOpt Global|HTI India|Webvi Solutions|CleanGreen|Acme|XYZ)\b/gi);
    if (companyMatch) {
      const uniqueNames = Array.from(new Set(companyMatch));
      for (const name of uniqueNames) {
        body = body.replace(new RegExp(`\\b${name}\\b`, "g"), `{{${companyField}|your team}}`);
      }
    }

    // Replace specific greetings with dynamic tag
    body = body.replace(/^(?:Dear|Hi|Hello)\s+[^,\n]+,/im, `{{greetingLine|Hi ${firstTag},}}`);

    // Parameterize partner strengths / focus if hardcoded in text
    body = body.replace(/hotel marketing and direct-booking growth/gi, "{{partnerStrength|hotel marketing and direct-booking growth}}");
    body = body.replace(/hospitality marketing for independent hotels and resorts[^\.\n]*/gi, `{{whatItDoes|aboutCompany|hospitality services}}`);
    body = body.replace(/“More Bookings, Better Operations”|"More Bookings, Better Operations"/gi, `{{initiativeHeadline|"More Bookings, Better Operations"}}`);
    body = body.replace(/“Guest Experience Beyond the Booking”|"Guest Experience Beyond the Booking"/gi, `{{initiativeHeadline|"Guest Experience Beyond the Booking"}}`);

    // Normalize quotes around merge tags
    body = body.replace(/“/g, '"').replace(/”/g, '"');

    // Extract subject if provided
    let subject = `FocusRealm & ${companyTag} — Collaborative Partnership Opportunity`;
    const subjectMatch = body.match(/^Subject:\s*(.+)$/im);
    if (subjectMatch && subjectMatch[1]) {
      subject = subjectMatch[1].trim();
      body = body.replace(/^Subject:\s*.+\n+/im, "");
    }

    if (!body.includes("FocusRealm") || !body.includes("https://")) {
      body += `\n\n${signOff}`;
    }

    const draft = {
      name: "Collaborative Partnership Outreach",
      subject: subject.slice(0, 100),
      body: body.replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n"),
    };
    return {
      ...draft,
      warnings: reviewTemplateDraft(draft, ctx.fields, ctx.totalContacts),
      source: "bot",
      model: "FocusRealm Template Engine",
    };
  }

  // 2. If brief is provided (no example):
  const isCoMarketOrPartnership = /partner|collaborat|co[\s-]?market|agency|synergy/i.test(input.brief);
  if (isCoMarketOrPartnership) {
    const draft = {
      name: "Collaborative Partnership Outreach",
      subject: `Exploring a collaborative initiative with ${companyTag}`,
      body: [
        `{{greetingLine|Hi ${firstTag},}}`,
        "I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
        `We see a potential opportunity for ${companyTag} and FocusRealm to collaborate by combining {{partnerStrength|hotel marketing and direct-booking growth}} with technology that helps hotels improve operational execution and service consistency.`,
        `${companyTag} focuses on {{whatItDoes|aboutCompany|hospitality services}}. At FocusRealm, we are building Mise Hotel, a hospitality-focused Service Execution Platform that helps hotels translate SOPs and service standards into assigned tasks, track completion, and improve operational visibility and accountability.`,
        `We believe these offerings could complement each other. {{partnerComplement|While your work helps hotels strengthen their visibility and guest acquisition, Mise Hotel can help them strengthen the operational processes and service standards that support the guest experience.}}`,
        `We would love to explore a joint {{initiativeHeadline|"More Bookings, Better Operations"}} initiative, combining {{partnerOffering|your core services}} with an operational execution pilot from FocusRealm. This could provide hotel clients with a more comprehensive approach to growth and service delivery.`,
        "Would you be available for a brief 20-minute discussion with Sehej to explore a potential collaboration and identify a suitable hotel for an initial pilot?",
        `Thank you for your time. We look forward to the possibility of working together.\n\n${signOff}`,
      ].join("\n\n"),
    };
    return {
      ...draft,
      warnings: reviewTemplateDraft(draft, ctx.fields, ctx.totalContacts),
      source: "bot",
      model: "FocusRealm Template Engine",
    };
  }

  // General brief fallback
  const draft = {
    name: "Executive Outreach Template",
    subject: `Connecting with ${companyTag}`,
    body: [
      `{{greetingLine|Hi ${firstTag},}}`,
      "I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
      input.brief.trim(),
      `Would you be available for a brief 15–20 minute conversation next week to explore whether there is a fit?`,
      `Best regards,\n${signOff}`,
    ].join("\n\n"),
  };
  return {
    ...draft,
    warnings: reviewTemplateDraft(draft, ctx.fields, ctx.totalContacts),
    source: "bot",
    model: "FocusRealm Template Engine",
  };
}
