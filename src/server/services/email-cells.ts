// Reading email addresses out of messy spreadsheet cells.
// - extractEmails: every valid address in a cell ("a@x.com; b@y.com", "Work: a@x.com (primary)")
// - suggestEmailFix: a *suggested* correction for a cell with no valid address ("john (at) gmail,com").
// - likelyTypo: a valid address at a misspelt provider ("priya@gmial.com" -> "priya@gmail.com").
//   Suggestions are shown to a person to confirm; they are never applied silently.
import { EmailSchema } from "../../shared/types.js";

// Local part excludes / | { } — legal but vanishingly rare, and common as separators in spreadsheets
const EMAIL_IN_TEXT = /[a-z0-9.!#$%&'*+=?^_`~-]+@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.[a-z]{2,24}/gi;
const SEPARATORS = /[\s,;|/<>()[\]"'`]+/g;

function isValid(email: string): boolean {
  return EmailSchema.safeParse(email).success;
}

/** Normalizations that don't change meaning: mailto:, full-width @, zero-width spaces */
function preclean(raw: string): string {
  return raw
    .replace(/[​-‍﻿]/g, "")
    .replace(/＠/g, "@")
    .replace(/mailto:/gi, " ");
}

export function extractEmails(raw: string): { emails: string[]; hadExtraText: boolean } {
  const text = preclean(raw);
  const found: string[] = [];
  for (const match of text.matchAll(EMAIL_IN_TEXT)) {
    const email = match[0].toLowerCase().replace(/^[.'-]+|[.'-]+$/g, "");
    if (isValid(email) && !found.includes(email)) found.push(email);
  }
  const leftover = found.reduce((t, e) => t.replace(new RegExp(e.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), " "), text).replace(SEPARATORS, "");
  return { emails: found, hadExtraText: found.length > 0 && leftover.length > 0 };
}

const PROVIDER_TYPOS: Record<string, string> = {
  "gmial.com": "gmail.com",
  "gamil.com": "gmail.com",
  "gmai.com": "gmail.com",
  "gmail.con": "gmail.com",
  "gmail.cm": "gmail.com",
  "gmail.co": "gmail.com",
  "gmaill.com": "gmail.com",
  "hotmial.com": "hotmail.com",
  "hotmai.com": "hotmail.com",
  "hotmail.con": "hotmail.com",
  "yahooo.com": "yahoo.com",
  "yaho.com": "yahoo.com",
  "yahoo.con": "yahoo.com",
  "outlok.com": "outlook.com",
  "outlook.con": "outlook.com",
};
const PROVIDERS_WITHOUT_TLD: Record<string, string> = { gmail: "gmail.com", yahoo: "yahoo.com", hotmail: "hotmail.com", outlook: "outlook.com", icloud: "icloud.com" };

/** The address with a misspelt well-known provider corrected, or null */
export function likelyTypo(email: string): string | null {
  const at = email.lastIndexOf("@");
  const fixed = at > 0 ? PROVIDER_TYPOS[email.slice(at + 1).toLowerCase()] : undefined;
  return fixed ? `${email.slice(0, at).toLowerCase()}@${fixed}` : null;
}

/** A likely intended address for a cell that contains none, or null if there's no confident guess */
export function suggestEmailFix(raw: string): string | null {
  let s = preclean(raw).trim().toLowerCase();
  if (!s) return null;
  s = s
    .replace(/\s*[([{]\s*at\s*[)\]}]\s*|\s+at\s+/g, "@")
    .replace(/\s*[([{]\s*dot\s*[)\]}]\s*|\s+dot\s+/g, ".")
    .replace(/\s+/g, "")
    .replace(/@+/g, "@")
    .replace(/,(?=[a-z]{2,6}$)/, ".") // "gmail,com"
    .replace(/\.{2,}/g, ".")
    .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, "");
  const at = s.indexOf("@");
  if (at <= 0 || s.indexOf("@", at + 1) !== -1) return null;
  let domain = s.slice(at + 1);
  domain = PROVIDER_TYPOS[domain] ?? PROVIDERS_WITHOUT_TLD[domain] ?? domain;
  const candidate = `${s.slice(0, at)}@${domain}`;
  return isValid(candidate) && candidate !== raw.trim().toLowerCase() ? candidate : null;
}
