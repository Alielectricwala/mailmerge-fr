// Template writer, shared by server and client:
// - the request/response shapes for AI drafting (Gemini, server-side)
// - built-in starter templates that need no API (generated from the fields the workspace has)
// - reviewTemplateDraft: soft checks on any generated draft before a person uses it
import { z } from "zod";
import { extractMergeFields, STANDARD_FIELDS } from "./merge.js";

export const WRITER_TONES = {
  warm: "Warm and personal",
  professional: "Professional",
  concise: "Short and direct",
  upbeat: "Upbeat",
} as const;
export type WriterTone = keyof typeof WRITER_TONES;

export const WRITER_LENGTHS = {
  short: { label: "Short", words: "60–90 words" },
  medium: { label: "Medium", words: "100–150 words" },
  long: { label: "Detailed", words: "160–220 words" },
} as const;
export type WriterLength = keyof typeof WRITER_LENGTHS;

export const TemplateDraftRequestSchema = z.object({
  brief: z.string().trim().min(10, "Describe the email in a sentence or two.").max(2000),
  tone: z.enum(Object.keys(WRITER_TONES) as [WriterTone, ...WriterTone[]]).default("warm"),
  length: z.enum(Object.keys(WRITER_LENGTHS) as [WriterLength, ...WriterLength[]]).default("medium"),
  /** An example email or the current draft to learn structure and voice from */
  example: z.string().trim().max(6000).optional(),
  signOff: z.string().trim().max(200).optional(),
});
export type TemplateDraftRequest = z.input<typeof TemplateDraftRequestSchema>;

/** A merge field the workspace can fill, with how many contacts have a value (0–1) */
export interface WriterField {
  name: string;
  label: string;
  coverage: number;
  custom: boolean;
}

export interface WriterContextDto {
  aiEnabled: boolean;
  model: string | null;
  totalContacts: number;
  fields: WriterField[];
}

export interface TemplateDraftDto {
  name: string;
  subject: string;
  /** Plain-text body using {{field}} / {{field|fallback}} */
  body: string;
  warnings: string[];
  source: "gemini" | "starter" | "bot";
  model?: string;
}

// ---------------------------------------------------------------------------
// Review: things a person should look at before using a draft
// ---------------------------------------------------------------------------

export function reviewTemplateDraft(draft: { subject: string; body: string }, fields: WriterField[], totalContacts: number): string[] {
  const warnings: string[] = [];
  const known = new Map(fields.map((f) => [f.name, f]));
  const SYNTHESIZED_FIELDS = new Set(["partnerComplement", "partnerFocus", "partnerProposal", "partnerCategory"]);
  for (const f of extractMergeFields({ subject: draft.subject, bodyHtml: draft.body })) {
    if (SYNTHESIZED_FIELDS.has(f.name)) continue;
    const field = known.get(f.name);
    if (!field) {
      warnings.push(`{{${f.name}}} isn't a field your contacts have. Remove it or import that column.`);
    } else if (f.required && totalContacts > 0 && field.coverage < 1) {
      const missing = Math.round((1 - field.coverage) * 100);
      warnings.push(`{{${f.name}}} has no fallback, and ${missing}% of contacts don't have it. They'd be skipped. Add one, e.g. {{${f.name}|…}}.`);
    }
  }
  if (/\[[^\]\n]{2,60}\]/.test(draft.subject + draft.body)) warnings.push("Replace the [bracketed] placeholders before using this.");
  if (/\*\*|^#{1,3}\s|^\s*[-*]\s/m.test(draft.body)) warnings.push("It contains markdown symbols (** # -) that will show as typed.");
  if (draft.subject.replace(/\{\{[^}]*\}\}/g, "xxxxxx").length > 78) warnings.push("The subject is long; most inboxes cut it off around 60–70 characters.");
  if (/unsubscribe/i.test(draft.body)) warnings.push("An unsubscribe line is added automatically; you can remove the one in the message.");
  return warnings;
}

// ---------------------------------------------------------------------------
// Starter templates (no API): picked by goal, shaped by tone and the fields available
// ---------------------------------------------------------------------------

export const STARTER_GOALS = {
  mise_pilot: { label: "Mise Hotel Outreach", description: "Frontline SOP execution & Advisory Board pilot." },
  co_market: { label: "Co-Market Partnership", description: "Training, recruitment, and service quality partner proposal." },
  introduction: { label: "Introduce yourself", description: "First email to someone new." },
  partnership: { label: "Propose a partnership", description: "Suggest working together." },
  meeting: { label: "Ask for a meeting", description: "Request a short call." },
  follow_up: { label: "Follow up", description: "Nudge after an earlier email." },
  event: { label: "Invite to an event", description: "Webinar, launch or visit." },
  thank_you: { label: "Say thank you", description: "After a call or a purchase." },
} as const;
export type StarterGoal = keyof typeof STARTER_GOALS;

const PLACE_FIELDS = ["city", "location", "region", "area", "town", "state"];
/** Custom columns that usually hold the organisation's name, e.g. "hotelName" */
const ORG_FIELD = /^(company|hotel|property|business|organi[sz]ation|brand|account|venue|restaurant|clinic|school)(name)?$/i;

export function buildStarterTemplate(args: { goal: StarterGoal; tone: WriterTone; fields: WriterField[]; signOff?: string }): TemplateDraftDto {
  const has = (name: string) => args.fields.some((f) => f.name === name && f.coverage > 0);
  const first = has("firstName") ? "{{firstName|there}}" : "there";
  const orgField = has("company") ? "company" : args.fields.find((f) => f.custom && f.coverage > 0 && ORG_FIELD.test(f.name))?.name;
  const company = orgField ? `{{${orgField}|your team}}` : "your team";
  const place = PLACE_FIELDS.find(has);
  const where = place ? ` in {{${place}|your area}}` : "";
  const t = args.tone;

  // Custom rich fields detection
  const whatItDoesField = ["whatItDoes", "aboutCompany", "servicesProvided", "focusArea"].find(has);
  const oppField = ["partnershipOpportunity", "personalizationAngle", "potentialPartnership"].find(has);

  const whatText = whatItDoesField
    ? `{{${whatItDoesField}|aboutCompany|servicesProvided|hospitality services}}`
    : "hospitality services";

  const coMarketGreeting = has("greetingLine") ? "{{greetingLine|Hi there,}}" : `Hi ${first},`;
  const partnerStrengthTag = has("partnerStrength") ? "{{partnerStrength|hotel marketing and direct-booking growth}}" : "hotel marketing and direct-booking growth";
  const partnerOfferingTag = has("partnerOffering") ? "{{partnerOffering|your core services}}" : "your core services";

  const defaultComplementWarm =
    "At FocusRealm, we're focused on helping hotels improve frontline service execution and operational consistency. While your work helps hotels strengthen their visibility and guest acquisition, we could potentially help those same properties deliver a more consistent guest experience once guests arrive.";

  const defaultComplementProf =
    "At FocusRealm, we help hotels strengthen frontline service execution and operational consistency. We believe there may be an opportunity to combine revenue-growth initiatives with operational improvements, helping selected properties focus on both commercial performance and the guest experience.";

  const defaultComplementConcise =
    "While you focus on core hospitality services, FocusRealm ensures frontline operational consistency without any service overlap.";

  const defaultComplementUpbeat =
    "We’re big believers that memorable guest experiences require both outstanding client engagement and rock-solid frontline execution.";

  const partnerComplementWarm = has("partnerComplement") ? `{{partnerComplement|${defaultComplementWarm}}}` : defaultComplementWarm;
  const partnerComplementProf = has("partnerComplement") ? `{{partnerComplement|${defaultComplementProf}}}` : defaultComplementProf;
  const partnerComplementConcise = has("partnerComplement") ? `{{partnerComplement|${defaultComplementConcise}}}` : defaultComplementConcise;
  const partnerComplementUpbeat = has("partnerComplement") ? `{{partnerComplement|${defaultComplementUpbeat}}}` : defaultComplementUpbeat;

  const oppText = oppField
    ? (has("initiativeHeadline") ? `{{initiativeHeadline|${oppField}|"More Bookings, Better Operations"}}` : `{{${oppField}|"More Bookings, Better Operations"}}`)
    : (has("initiativeHeadline") ? '{{initiativeHeadline|"More Bookings, Better Operations"}}' : '"More Bookings, Better Operations"');

  const foundersSignOff = args.signOff?.trim()
    ? args.signOff.trim().includes("\n")
      ? args.signOff.trim()
      : `${args.signOff.trim()}\nFounder’s Office\nFocusRealm\nhttps://misehotel.com/\nhttps://focusrealm.org/`
    : "Founder’s Office\nFocusRealm\nhttps://misehotel.com/\nhttps://focusrealm.org/";

  // Tone-specific templates for each goal
  if (args.goal === "co_market") {
    switch (t) {
      case "warm":
        return {
          name: "Co-Market Partnership (warm and personal)",
          subject: `Exploring a collaborative initiative with ${company}`,
          body: [
            coMarketGreeting,
            "I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
            `We see a potential opportunity for ${company} and FocusRealm to collaborate by combining ${partnerStrengthTag} with technology that helps hotels improve operational execution and service consistency.`,
            `${company} focuses on ${whatText}. At FocusRealm, we are building Mise Hotel, a hospitality-focused Service Execution Platform that helps hotels translate SOPs and service standards into assigned tasks, track completion, and improve operational visibility and accountability.`,
            `We believe these offerings could complement each other. ${partnerComplementWarm}`,
            `We would love to explore a joint ${oppText} initiative, combining ${partnerOfferingTag} with an operational execution pilot from FocusRealm. This could provide hotel clients with a more comprehensive approach to growth and service delivery.`,
            "Would you be available for a brief 20-minute discussion with Sehej to explore a potential collaboration and identify a suitable hotel for an initial pilot?",
            `Thank you for your time. We look forward to the possibility of working together.\n\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };

      case "professional":
        return {
          name: "Co-Market Partnership (professional)",
          subject: `FocusRealm & ${company} — Strategic Collaboration Opportunity`,
          body: [
            has("greetingLine") ? "{{greetingLine|Hello there,}}" : `Hello ${first},`,
            "I am reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
            `We see a meaningful opportunity for ${company} and FocusRealm to collaborate by combining ${partnerStrengthTag} with technology that ensures frontline operational consistency.`,
            `${company} focuses on ${whatText}. At FocusRealm, we developed Mise Hotel to help properties translate service standards and operating procedures into assigned, verified daily tasks.`,
            `We believe our capabilities naturally complement each other. ${partnerComplementProf}`,
            `We would be interested in exploring a joint ${oppText} initiative, pairing ${partnerOfferingTag} with an operational execution pilot from FocusRealm to deliver end-to-end value for hotel clients.`,
            "Would you or someone from your leadership team be available for a 20-minute introductory conversation with Sehej to assess mutual fit?",
            `Thank you for your consideration.\n\nBest regards,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };

      case "concise":
        return {
          name: "Co-Market Partnership (short and direct)",
          subject: `Complementary fit for ${company}`,
          body: [
            coMarketGreeting,
            "I'm reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
            `We see a direct way for ${company} and FocusRealm to collaborate by connecting ${whatText} with our Mise Hotel frontline execution platform.`,
            `${partnerComplementConcise} We would love to explore a joint ${oppText} initiative for mutual hotel clients without any operational overlap.`,
            "Would you be open to a 15-minute call with Sehej next week to explore whether there's a good fit?",
            `Best,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };

      case "upbeat":
        return {
          name: "Co-Market Partnership (upbeat)",
          subject: `Teaming up with ${company} — operational synergy!`,
          body: [
            has("greetingLine") ? "{{greetingLine|Hi there!}}" : `Hi ${first}!`,
            "I’m reaching out from the Founder’s Office at FocusRealm on behalf of Sehej Sharma.",
            `We love what ${company} is building across ${whatText}, and we see a great opportunity to team up!`,
            `At FocusRealm, our Mise Hotel platform helps hotels verify daily service execution on the floor. ${partnerComplementUpbeat}`,
            `We’d love to explore a joint ${oppText} initiative, combining your expertise with an operational pilot from FocusRealm for selected properties.`,
            "Would you be open to a quick 15–20 minute chat with Sehej to explore what a pilot could look like?",
            `Cheers,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };
    }
  }

  if (args.goal === "mise_pilot") {
    switch (t) {
      case "warm":
        return {
          name: "Mise Hotel Outreach (warm and personal)",
          subject: `Ensuring frontline service execution at ${company}`,
          body: [
            `Hi ${first},`,
            "I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
            "One of the key challenges in hospitality is ensuring that SOPs, training, and service standards defined at the corporate level are consistently followed by frontline teams across properties. Even when standards are clearly documented, ensuring that tasks are executed correctly, verified, and recorded can be difficult across multiple teams and locations.",
            "Mise Hotel, our hospitality-focused Service Execution Platform, is designed to address this challenge by bringing SOPs, training, and operational workflows together in a mobile-first platform. It helps translate documented standards into assigned tasks, supports teams in executing them, and captures evidence of completion to improve operational visibility and accountability.",
            `As we continue developing Mise Hotel, we would welcome the opportunity to explore a pilot with ${company} to demonstrate the platform, understand your operational requirements, and gather feedback from your team.`,
            `We are also bringing together experienced hospitality leaders for the FocusRealm Hotel Advisory Board, where industry experts can help shape Mise Hotel around the real-world needs of hotel operations, workforce training, and service delivery. Given ${company}’s experience in the hospitality industry, we would be honoured to explore your potential involvement.`,
            "Would your team be available for a 20-minute meeting with Sehej to discuss Mise Hotel, a potential pilot, and the advisory opportunity? We would be happy to coordinate a time that suits your schedule.",
            "Thank you for your time. We look forward to connecting.",
            `Best wishes,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };

      case "professional":
        return {
          name: "Mise Hotel Outreach (professional)",
          subject: `Operational consistency & SOP compliance for ${company}`,
          body: [
            `Hello ${first},`,
            "I am writing on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
            "Across multi-property hospitality portfolios, standard operating procedures and brand standards are thoroughly documented, yet verifying daily frontline execution remains an operational blind spot.",
            "FocusRealm's Mise Hotel platform bridges this gap. We translate corporate SOPs and brand audits into structured, mobile task checklists with mandatory completion evidence and real-time operational oversight for leadership.",
            `We are currently selecting property partners for a structured evaluation pilot with ${company} to measure impact on compliance and operational accountability.`,
            "Would you or your operations director be open to a 20-minute discussion with Sehej next week to review the pilot parameters?",
            `Kind regards,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };

      case "concise":
        return {
          name: "Mise Hotel Outreach (short and direct)",
          subject: `Frontline execution at ${company}`,
          body: [
            `Hi ${first},`,
            "I'm reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.",
            `Ensuring frontline hotel teams execute corporate SOPs consistently is a persistent headache. Mise Hotel translates your documented standards into assigned mobile tasks with verified completion records.`,
            `We'd welcome the chance to run a quick 30-day pilot with ${company} to prove the operational visibility it gives your leadership team.`,
            "Would you have 15 minutes for a brief call with Sehej next Tuesday or Thursday?",
            `Best,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };

      case "upbeat":
        return {
          name: "Mise Hotel Outreach (upbeat)",
          subject: `Empowering frontline teams at ${company}`,
          body: [
            `Hi ${first}!`,
            "I’m reaching out from the Founder’s Office at FocusRealm on behalf of Sehej Sharma.",
            `Great hospitality lives and dies on frontline execution. We built Mise Hotel to empower property teams with a super intuitive mobile tool that turns complex SOPs into clear daily wins.`,
            `We'd love to partner with ${company} on a pilot demonstration, and invite you to share your insights on our FocusRealm Hotel Advisory Board!`,
            "Could we grab 15 minutes with Sehej to show you how it works?",
            `Cheers,\n${foundersSignOff}`,
          ].join("\n\n"),
          warnings: [],
          source: "starter",
        };
    }
  }

  // General templates: ensure each tone produces distinct voice and structure
  const greeting = t === "professional" ? `Hello ${first},` : t === "upbeat" ? `Hi ${first}!` : `Hi ${first},`;
  const closing = { warm: "Warm regards,", professional: "Kind regards,", concise: "Thanks,", upbeat: "Cheers," }[t];
  const sign = args.signOff?.trim() || "The FocusRealm team";

  const generalGoals: Record<Exclude<StarterGoal, "mise_pilot" | "co_market">, Record<WriterTone, { subject: string; paragraphs: string[] }>> = {
    introduction: {
      warm: {
        subject: `A warm introduction for ${company}`,
        paragraphs: [
          `I wanted to reach out because we've been following what ${company} is building${where}, and there seems to be a wonderful fit between our approaches.`,
          "We focus on keeping things simple: a friendly conversation to understand what you're working toward, and sharing practical ideas you can use right away.",
          "Would you be open to a relaxed 15-minute call next week?",
        ],
      },
      professional: {
        subject: `Introduction: FocusRealm & ${company}`,
        paragraphs: [
          `I am writing to introduce FocusRealm to ${company}${where}. We work with hospitality and service organizations to strengthen operational execution and service consistency.`,
          "Our objective is straightforward: a brief discussion to understand your current operational priorities and evaluate whether there is strategic alignment.",
          "Would you have 15 minutes available for an introductory conversation next week?",
        ],
      },
      concise: {
        subject: `Quick intro for ${company}`,
        paragraphs: [
          `Reaching out because we work with organizations like ${company}${where} on operational execution.`,
          "Would you have 10–15 minutes for a brief call next week to see if there's mutual relevance?",
        ],
      },
      upbeat: {
        subject: `Hello from FocusRealm — love what ${company} is up to!`,
        paragraphs: [
          `I’ve been admiring the work ${company} is doing${where} and couldn't resist reaching out!`,
          "We help innovative teams unlock effortless operational execution, and I think we could do something really exciting together.",
          "Let's grab 15 minutes for a quick chat next week — do you have a few minutes to connect?",
        ],
      },
    },
    partnership: {
      warm: {
        subject: `Exploring a collaborative partnership with ${company}`,
        paragraphs: [
          `I've been looking at how ${company} works${where}, and I'd love to explore how we might support each other in serving our respective communities.`,
          "I have a few concrete ideas in mind, from shared client initiatives to joint introductions, and I'd love to explore what would be most valuable for you.",
          "Could we set aside 20 minutes to talk it through?",
        ],
      },
      professional: {
        subject: `Strategic Collaboration Proposal: ${company}`,
        paragraphs: [
          `I am writing to propose a strategic collaboration between FocusRealm and ${company}${where}.`,
          "Given our complementary service capabilities, a structured referral or joint initiative presents clear commercial and operational advantages for our shared client base.",
          "Would you or a representative from your leadership team be open to a 20-minute meeting to discuss mutual fit?",
        ],
      },
      concise: {
        subject: `Partnership idea for ${company}`,
        paragraphs: [
          `We see a natural way to collaborate with ${company}${where} by complementing your existing service offerings without overlap.`,
          "Are you open to a 15-minute call to see if a joint referral or co-marketing initiative makes sense?",
        ],
      },
      upbeat: {
        subject: `Let's team up! Partnership idea for ${company}`,
        paragraphs: [
          `Big fan of what ${company} is doing${where}! We see a fantastic synergy between our two teams and would love to build something great together.`,
          "We’ve put together a few fun, high-impact collaboration ideas that could deliver immediate value to your clients.",
          "Up for a 15-minute brainstorming session next week?",
        ],
      },
    },
    meeting: {
      warm: {
        subject: `15 minutes with ${company} next week?`,
        paragraphs: [
          `I'd really value a short conversation to learn more about ${company}'s plans for the coming months and see where we might be able to help.`,
          "Does Tuesday or Thursday afternoon work? If another time suits you better, just let me know and I'll gladly adjust.",
        ],
      },
      professional: {
        subject: `Brief meeting request regarding ${company}`,
        paragraphs: [
          `I would appreciate the opportunity for a 15-minute meeting to discuss your current operational initiatives and explore potential synergies with FocusRealm.`,
          "Please let me know if Tuesday or Thursday afternoon aligns with your schedule, or feel free to suggest an alternative time.",
        ],
      },
      concise: {
        subject: `15 minutes next week?`,
        paragraphs: [
          `Could we schedule a 15-minute call next week to discuss ${company}'s operational priorities?`,
          "Does Tuesday or Thursday afternoon suit your calendar?",
        ],
      },
      upbeat: {
        subject: `Quick coffee chat with ${company}?`,
        paragraphs: [
          `Would love to catch up for 15 minutes to hear all about what’s next for ${company}!`,
          "Are you free for a quick chat next Tuesday or Thursday afternoon?",
        ],
      },
    },
    follow_up: {
      warm: {
        subject: "Circling back on my earlier note",
        paragraphs: [
          "I wanted to follow up gently on my earlier note in case it got buried under a busy week.",
          `I'm still very keen to hear how things are going at ${company} and whether a quick conversation would be helpful.`,
          "A one-line reply is plenty, even if now isn't the right time.",
        ],
      },
      professional: {
        subject: `Following up: FocusRealm & ${company}`,
        paragraphs: [
          "I am following up on my previous correspondence regarding potential operational synergies between our organizations.",
          `Please let me know if you or a member of your team would have 15 minutes to connect, or if we should revisit this at a later date.`,
        ],
      },
      concise: {
        subject: "Quick follow-up",
        paragraphs: [
          `Following up on my previous email regarding ${company}.`,
          "Do you have 10 minutes to connect this week, or is it better to reconnect next quarter?",
        ],
      },
      upbeat: {
        subject: `Checking back in with ${company}!`,
        paragraphs: [
          "Just bumping this to the top of your inbox! Hope you're having a productive week.",
          `Still super excited about the chance to connect with ${company}. Let me know if you have 10 minutes to chat!`,
        ],
      },
    },
    event: {
      warm: {
        subject: `You're warmly invited, ${first === "there" ? "friend" : "{{firstName|friend}}"}`,
        paragraphs: [
          `We're hosting an intimate session for teams like ${company}${where}, and I would truly love for you to join us.`,
          "It's practical, candid and short: what's working right now, what isn't, and plenty of time for open discussion.",
          "Reply to this email and I'll gladly reserve your spot and send over the details.",
        ],
      },
      professional: {
        subject: `Executive Briefing Invitation: ${company}`,
        paragraphs: [
          `You are invited to an executive briefing designed for leadership teams across ${company}${where}.`,
          "The agenda focuses on data-backed insights on hospitality frontline consistency and operational benchmarks.",
          "Please RSVP by replying to this message to receive formal attendance credentials.",
        ],
      },
      concise: {
        subject: "Session invite",
        paragraphs: [
          `Hosting a short executive session for teams like ${company}${where}.`,
          "Reply here if you'd like an invite with schedule details.",
        ],
      },
      upbeat: {
        subject: `You're invited! Exclusive session for ${company}`,
        paragraphs: [
          `We're gathering a fantastic group of leaders from teams like ${company}${where}, and we want you in the room!`,
          "Expect great energy, fresh ideas, and actionable takeaways you can apply right away.",
          "Hit reply to claim your spot before spaces fill up!",
        ],
      },
    },
    thank_you: {
      warm: {
        subject: "Thank you for your time",
        paragraphs: [
          `Thank you so much for your time today${orgField ? ` and for everything the team at {{${orgField}|your company}} shared` : ""}. I really enjoyed our conversation.`,
          "As promised, I'll follow up with the next steps shortly. Please feel free to reach out anytime.",
        ],
      },
      professional: {
        subject: `Thank you — ${company} & FocusRealm discussion`,
        paragraphs: [
          `Thank you for taking the time to meet today to discuss ${company}'s operational objectives.`,
          "I will prepare and circulate the agreed action items and next steps by end of week.",
        ],
      },
      concise: {
        subject: "Thank you",
        paragraphs: [
          `Thanks for your time today discussing ${company}.`,
          "I'll follow up with the next steps shortly.",
        ],
      },
      upbeat: {
        subject: `Loved our chat today! Thank you, ${first === "there" ? "friend" : "{{firstName|friend}}"}`,
        paragraphs: [
          `Thank you so much for connecting today! Loved learning more about where ${company} is headed.`,
          "I'll send over the details we discussed shortly. Excited for what’s ahead!",
        ],
      },
    },
  };

  const g = generalGoals[args.goal as keyof typeof generalGoals][t];
  const body = [greeting, ...g.paragraphs, `${closing}\n${sign}`].join("\n\n");
  return { name: `${STARTER_GOALS[args.goal].label} (${WRITER_TONES[t].toLowerCase()})`, subject: g.subject, body, warnings: [], source: "starter" };
}

/** Standard fields with labels, for building a WriterField list */
export const STANDARD_FIELD_LABELS: Record<string, string> = Object.fromEntries(STANDARD_FIELDS.map((f) => [f.name, f.label]));
