// Signed unsubscribe links (RFC 8058 one-click compatible) and the footer every campaign email carries.
import crypto from "crypto";
import { env } from "../config.js";
import { escapeHtml } from "../../shared/merge.js";

function signature(sendId: string): string {
  return crypto.createHmac("sha256", env.APP_SECRET).update(`unsubscribe:${sendId}`).digest("base64url").slice(0, 32);
}

export function unsubscribeToken(sendId: string): string {
  return `${sendId}.${signature(sendId)}`;
}

/** Returns the send id if the token is authentic, otherwise null */
export function verifyUnsubscribeToken(token: string): string | null {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const sendId = token.slice(0, dot);
  const given = Buffer.from(token.slice(dot + 1));
  const expected = Buffer.from(signature(sendId));
  return given.length === expected.length && crypto.timingSafeEqual(given, expected) ? sendId : null;
}

export function unsubscribeUrl(sendId: string): string {
  return `${env.PUBLIC_URL.replace(/\/$/, "")}/u/${unsubscribeToken(sendId)}`;
}

/** Appends the unsubscribe footer; called once at approval so stored content == delivered content */
export function withFooter(html: string, text: string, url: string, senderName: string): { html: string; text: string } {
  const footerHtml =
    `<div style="margin-top:32px;padding-top:16px;border-top:1px solid #DCE4F0;font-family:Arial,sans-serif;font-size:12px;line-height:18px;color:#64748B">` +
    `You received this email from ${escapeHtml(senderName)}. ` +
    `<a href="${escapeHtml(url)}" style="color:#64748B;text-decoration:underline">Unsubscribe</a> to stop receiving these emails.` +
    `</div>`;
  const footerText = `\n\n--\nYou received this email from ${senderName}. Unsubscribe: ${url}`;

  const bodyClose = html.search(/<\/body>/i);
  const nextHtml = bodyClose === -1 ? html + footerHtml : html.slice(0, bodyClose) + footerHtml + html.slice(bodyClose);
  return { html: nextHtml, text: text + footerText };
}

export function unsubscribeHeaders(url: string): Record<string, string> {
  return {
    "List-Unsubscribe": `<${url}>`,
    "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
  };
}
