// Merge-field engine shared by server (sending, approval) and client (editor, preview).
//
// Syntax: {{fieldName}} or {{fieldName|fallback text}}
// - Field names: letters, digits, underscore; must start with a letter or underscore.
// - A field without a fallback is required: a recipient missing it is reported, never
//   silently sent with a blank.
// - Values are HTML-escaped in HTML bodies and stripped of line breaks in subjects.

import { synthesizeRecipientPersonalization } from "./partner-intelligence.js";

export interface MergeField {
  name: string;
  fallback?: string;
  required: boolean;
}

export interface TemplateParts {
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
}

export interface RenderedEmail {
  subject: string;
  html: string;
  text: string;
  /** Required fields with no value for this recipient */
  missingFields: string[];
}

export type MergeData = Record<string, unknown>;

const FIELD_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Any {{ ... }} token whose content has no braces
const TOKEN = /\{\{([^{}]*)\}\}/g;

/** Built-in contact fields available to every template, in display order */
export const STANDARD_FIELDS = [
  { name: "firstName", label: "First name" },
  { name: "lastName", label: "Last name" },
  { name: "fullName", label: "Full name" },
  { name: "email", label: "Email" },
  { name: "company", label: "Company" },
  { name: "title", label: "Job title" },
  { name: "phone", label: "Phone" },
] as const;

export interface ParsedToken {
  name: string;
  fieldChain: string[];
  fallback?: string;
}

export function parseToken(raw: string): ParsedToken | null {
  const parts = raw.split("|").map((p) => p.trim());
  if (parts.length === 0 || !parts[0]) return null;
  const firstName = parts[0];
  if (!FIELD_NAME.test(firstName)) return null;

  if (parts.length === 1) {
    return { name: firstName, fieldChain: [firstName] };
  }

  const candidateFields: string[] = [];
  let fallback: string | undefined = undefined;

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]!;
    if (i === parts.length - 1) {
      fallback = part;
    } else {
      if (FIELD_NAME.test(part)) {
        candidateFields.push(part);
      }
    }
  }

  return {
    name: firstName,
    fieldChain: candidateFields.length > 0 ? candidateFields : [firstName],
    fallback,
  };
}

/** All merge fields used across the given template parts (first occurrence wins for fallback) */
export function extractMergeFields(parts: TemplateParts): MergeField[] {
  const fields = new Map<string, MergeField>();
  for (const text of [parts.subject, parts.bodyHtml, parts.bodyText ?? ""]) {
    for (const match of text.matchAll(TOKEN)) {
      const token = parseToken(match[1]!);
      if (!token) continue;
      for (const fieldName of token.fieldChain) {
        const existing = fields.get(fieldName);
        if (!existing) {
          fields.set(fieldName, { name: fieldName, fallback: token.fallback, required: token.fallback === undefined });
        } else if (token.fallback === undefined) {
          existing.required = true;
        }
      }
    }
  }
  return [...fields.values()];
}

/** Syntax problems, phrased for the person editing the template. Empty array = valid. */
export function validateTemplate(parts: TemplateParts): string[] {
  const errors: string[] = [];
  const named: [string, string][] = [
    ["Subject", parts.subject],
    ["HTML body", parts.bodyHtml],
    ["Plain-text body", parts.bodyText ?? ""],
  ];

  if (!parts.subject.trim()) errors.push("Subject is empty.");
  if (!parts.bodyHtml.trim()) errors.push("Email body is empty.");

  for (const [label, text] of named) {
    if (/\{\{[^}]*\{\{/.test(text)) {
      errors.push(`${label}: merge fields can't be nested inside each other.`);
      continue;
    }
    const opens = (text.match(/\{\{/g) ?? []).length;
    const closes = (text.match(/\}\}/g) ?? []).length;
    if (opens !== closes) {
      errors.push(`${label}: a merge field is missing its closing "}}" or opening "{{".`);
      continue;
    }

    // Check for malformed single-brace tags like {firstName|...}
    if (/(?<!\{)\{[a-zA-Z0-9_]+\|[^}]*\}(?!\})/.test(text)) {
      errors.push(`${label}: single-brace tag detected. Merge tags must use double curly braces: "{{fieldName|fallback}}".`);
    }

    // Check for empty fallback after pipe, e.g. {{firstName|}} or {{firstName| }}
    if (/\{\{[a-zA-Z0-9_]+(?:\s*\|\s*[a-zA-Z0-9_]+)*\s*\|\s*\}\}/.test(text)) {
      errors.push(`${label}: contains an empty fallback after "|". Provide a fallback value or remove the pipe.`);
    }

    for (const match of text.matchAll(TOKEN)) {
      const parsed = parseToken(match[1]!);
      if (!parsed) {
        errors.push(`${label}: "{{${match[1]}}}" isn't a valid field name. Use letters, numbers or _ with no spaces.`);
      } else if (parsed.fallback !== undefined && parsed.fallback.trim() === "") {
        errors.push(`${label}: "{{${match[1]}}}" has an empty fallback after "|". Provide a fallback value or remove the pipe.`);
      }
    }
  }
  return errors;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** A value counts as present only if it is a non-blank string/number/boolean */
export function resolveValue(data: MergeData, name: string): string | undefined {
  const value = data[name];
  if (value === null || value === undefined) return undefined;
  const str = typeof value === "string" ? value : typeof value === "number" || typeof value === "boolean" ? String(value) : undefined;
  return str !== undefined && str.trim() !== "" ? str : undefined;
}

type Mode = "html" | "text" | "subject";

function renderPart(text: string, data: MergeData, mode: Mode, missing: Set<string>): string {
  return text.replace(TOKEN, (whole, raw: string) => {
    const token = parseToken(raw);
    if (!token) return whole;

    let value: string | undefined = undefined;

    // 1. Try primary field and any chained fallback fields
    for (const field of token.fieldChain) {
      value = resolveValue(data, field);
      if (value !== undefined) break;
    }

    // 2. If still undefined, check if the fallback itself matches a field present in data
    if (value === undefined && token.fallback !== undefined && FIELD_NAME.test(token.fallback)) {
      const fieldVal = resolveValue(data, token.fallback);
      if (fieldVal !== undefined) {
        value = fieldVal;
      }
    }

    // 3. If still undefined, use the fallback literal string
    if (value === undefined) {
      if (token.fallback === undefined) {
        missing.add(token.name);
      }
      value = token.fallback ?? "";
    }

    if (mode === "html") return escapeHtml(value);
    if (mode === "subject") return value.replace(/[\r\n]+/g, " ");
    return value;
  });
}

/** Very small HTML -> text conversion for the plain-text alternative when none is written */
export function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n")
    .replace(/<li[^>]*>/gi, "• ")
    .replace(/<a [^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/gi, (_m, href: string, label: string) =>
      label.replace(/<[^>]+>/g, "").trim() === href ? href : `${label} (${href})`
    )
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Plain-text email -> simple HTML: blank lines become paragraphs, single newlines <br>,
 * URLs become links. Merge tokens are left untouched so their fallbacks aren't double-escaped.
 */
export function plainTextToHtml(text: string): string {
  const escapeOutsideTokens = (s: string) =>
    s
      .split(/(\{\{[^{}]*\}\})/g)
      .map((part, i) => (i % 2 === 1 ? part : escapeHtml(part).replace(/https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (url) => `<a href="${url}">${url}</a>`)))
      .join("");
  return text
    .replace(/\r\n/g, "\n")
    .trim()
    .split(/\n{2,}/)
    .map((para) => `<p>${escapeOutsideTokens(para).replace(/\n/g, "<br>")}</p>`)
    .join("\n");
}

/** True when the HTML body is exactly what plainTextToHtml makes from the text body */
export function isPlainTextTemplate(parts: TemplateParts): boolean {
  return Boolean(parts.bodyText && parts.bodyHtml === plainTextToHtml(parts.bodyText));
}

export function renderEmail(parts: TemplateParts, data: MergeData): RenderedEmail {
  const missing = new Set<string>();
  let subject = renderPart(parts.subject, data, "subject", missing).trim();
  let html = renderPart(parts.bodyHtml, data, "html", missing);
  let text = parts.bodyText?.trim() ? renderPart(parts.bodyText, data, "text", missing) : htmlToText(html);

  // Strip placeholder sender names like Demo Founder
  html = html.replace(/Demo Founder\s*(<br\s*\/?>)?/gi, "");
  text = text.replace(/Demo Founder\s*\n?/gi, "");

  // Maintain consistent FocusRealm branding throughout
  subject = subject.replace(/Focus Realm/g, "FocusRealm");
  html = html.replace(/Focus Realm/g, "FocusRealm");
  text = text.replace(/Focus Realm/g, "FocusRealm");

  // Safety guard: detect any unreplaced merge tokens or malformed single-brace tokens
  const fullContent = `${subject}\n${text}`;
  const unreplaced = fullContent.match(/\{\{([a-zA-Z0-9_]+)[^}]*\}\}/g);
  if (unreplaced) {
    for (const tag of unreplaced) {
      const match = tag.match(/\{\{([a-zA-Z0-9_]+)/);
      if (match && match[1]) missing.add(match[1]);
    }
  }
  const malformedSingle = fullContent.match(/(?<!\{)\{([a-zA-Z0-9_]+)\|[^}]*\}(?!\})/g);
  if (malformedSingle) {
    for (const tag of malformedSingle) {
      const match = tag.match(/\{([a-zA-Z0-9_]+)/);
      if (match && match[1]) missing.add(match[1]);
    }
  }

  return { subject, html, text, missingFields: [...missing] };
}

export interface ContactLike {
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  phone?: string | null;
  hotelSegment?: string | null;
  contactPersona?: string | null;
  customFields?: unknown;
}

/** Flattens a contact (standard + custom fields) into clean, normalized merge data */
export function contactMergeData(contact: ContactLike, overrides?: MergeData): MergeData {
  return synthesizeRecipientPersonalization(contact, overrides).mergeData;
}
