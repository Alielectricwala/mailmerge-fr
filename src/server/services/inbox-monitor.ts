// Read-only IMAP monitor: finds bounce reports and replies to our sends in the SpaceMail inbox.
// Opens INBOX read-only (no flags changed, nothing moved) and remembers the last UID it processed.
import { ImapFlow } from "imapflow";
import { simpleParser, type ParsedMail } from "mailparser";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { env, imapConfigured } from "../config.js";
import { messageIdDomain } from "./mailer.js";
import { classifyIncoming, classifyReplySentiment, type IncomingMessage } from "./inbox-classifier.js";
import { stopSequenceForRecipient } from "./sequence-service.js";

const STATE_KEY = "imap.state";
const FIRST_RUN_LOOKBACK_DAYS = 14;
const MAX_MESSAGES_PER_RUN = 500;
const MAX_MESSAGE_BYTES = 2 * 1024 * 1024;

export interface ImapState {
  uidValidity?: string;
  lastUid?: number;
  lastCheckedAt?: string;
  lastError?: string | null;
  processed?: { bounces: number; replies: number };
  unmatchedReplies?: {
    from: string;
    subject: string;
    snippet: string;
    date: string;
    detectedSentiment: string;
  }[];
}

export async function getImapState(): Promise<ImapState> {
  const row = await prisma.setting.findUnique({ where: { key: STATE_KEY } });
  return (row?.value as ImapState | undefined) ?? {};
}

async function saveImapState(state: ImapState) {
  await prisma.setting.upsert({
    where: { key: STATE_KEY },
    update: { value: state as Prisma.InputJsonValue },
    create: { key: STATE_KEY, value: state as Prisma.InputJsonValue },
  });
}

function toIncoming(mail: ParsedMail): IncomingMessage {
  // Raw header values (unfolded), keyed by lower-case name; first occurrence wins
  const headers: Record<string, string> = {};
  for (const { key, line } of mail.headerLines) {
    headers[key] ??= line.slice(line.indexOf(":") + 1).replace(/\r?\n[ \t]+/g, " ").trim();
  }
  return {
    from: mail.from?.text ?? "",
    subject: mail.subject ?? "",
    headers,
    text: mail.text ?? "",
    attachments: mail.attachments.map((a) => ({ contentType: a.contentType, content: a.content.toString("utf8").slice(0, 200_000) })),
    date: mail.date ?? new Date(),
  };
}

/** Applies one classified message. Idempotent: re-processing the same message changes nothing. */
async function applyClassification(message: IncomingMessage, domain: string): Promise<"bounce" | "reply" | null> {
  const result = classifyIncoming(message, domain);
  if (result.type === "other" || result.type === "auto_reply") return null;

  const sends = await prisma.send.findMany({ where: { messageId: { in: result.messageIds } } });
  let targets = sends;
  if (!targets.length) {
    if (result.type === "bounce" && result.recipient) {
      // Some servers drop original headers; fall back to most recent send to that address
      const recent = await prisma.send.findFirst({ where: { email: result.recipient, status: "SENT" }, orderBy: { sentAt: "desc" } });
      targets = recent ? [recent] : [];
    } else if (result.type === "reply") {
      // Extract from email from header
      const fromEmail = message.from.match(/<([^>]+)>/)?.[1] || message.from.trim();
      if (fromEmail) {
        const recent = await prisma.send.findFirst({ where: { email: fromEmail, status: "SENT" }, orderBy: { sentAt: "desc" } });
        if (recent) targets = [recent];
      }
    }
  }

  // If a reply still cannot be matched to any send record, record as unmatched
  if (!targets.length && result.type === "reply") {
    const sentiment = classifyReplySentiment(result.snippet || message.text, message.subject);
    const state = await getImapState();
    const unmatched = state.unmatchedReplies ?? [];
    unmatched.unshift({
      from: message.from,
      subject: message.subject,
      snippet: result.snippet,
      date: message.date.toISOString(),
      detectedSentiment: sentiment.sentiment,
    });
    // Keep last 50 unmatched replies
    await saveImapState({ ...state, unmatchedReplies: unmatched.slice(0, 50) });
    return null;
  }

  for (const send of targets) {
    if (result.type === "bounce") {
      const type = result.hard ? "HARD_BOUNCE" : "SOFT_BOUNCE";
      const already = await prisma.sendEvent.findFirst({ where: { sendId: send.id, type } });
      if (already) continue;
      await prisma.$transaction(async (tx) => {
        await tx.sendEvent.create({ data: { sendId: send.id, type, occurredAt: message.date, detail: { diagnostic: result.diagnostic, from: message.from } } });
        if (result.hard) {
          await tx.send.update({ where: { id: send.id }, data: { bouncedAt: message.date } });
          await tx.suppressionEntry.upsert({
            where: { email: send.email },
            update: {},
            create: { email: send.email, reason: "HARD_BOUNCE", source: "bounce-report", campaignId: send.campaignId, metadata: { diagnostic: result.diagnostic } },
          });
          await stopSequenceForRecipient(send.campaignId, send.email, `Hard bounce: ${result.diagnostic}`, "BOUNCED", tx);
        }
      });
    } else {
      const already = await prisma.sendEvent.findFirst({ where: { sendId: send.id, type: "REPLY" } });
      if (already) continue;
      const sentiment = classifyReplySentiment(result.snippet || message.text, message.subject);
      await prisma.$transaction(async (tx) => {
        await tx.sendEvent.create({
          data: {
            sendId: send.id,
            type: "REPLY",
            occurredAt: message.date,
            detail: {
              from: message.from,
              subject: message.subject,
              snippet: result.snippet,
              classification: sentiment.sentiment,
              confidence: sentiment.confidence,
              matchedKeywords: sentiment.matchedKeywords,
              meetingBooked: false,
            },
          },
        });
        await tx.send.update({ where: { id: send.id }, data: { repliedAt: send.repliedAt ?? message.date } });
        if (sentiment.sentiment === "UNSUBSCRIBE") {
          await tx.suppressionEntry.upsert({
            where: { email: send.email },
            update: {},
            create: { email: send.email, reason: "UNSUBSCRIBE", source: "reply-unsubscribe", campaignId: send.campaignId, metadata: { snippet: result.snippet } },
          });
          await stopSequenceForRecipient(send.campaignId, send.email, "Unsubscribe requested in reply", "SUPPRESSED", tx);
        } else {
          await stopSequenceForRecipient(send.campaignId, send.email, "Reply received — automated outreach stopped", "REPLY_RECEIVED", tx);
        }
      });
    }
  }
  return targets.length ? result.type : null;
}

export async function isInboxMonitoringSafe(): Promise<{ safe: boolean; reason?: string }> {
  if (!imapConfigured || !env.IMAP_POLL_ENABLED) return { safe: true };
  const state = await getImapState();
  if (state.lastError) {
    return { safe: false, reason: `Inbox monitoring error: ${state.lastError}` };
  }
  if (!state.lastCheckedAt) {
    return { safe: false, reason: "Inbox monitoring has not executed yet" };
  }
  const ageMs = Date.now() - new Date(state.lastCheckedAt).getTime();
  const maxStaleMs = (env.IMAP_POLL_INTERVAL_SECONDS * 4 + 180) * 1000;
  if (ageMs > maxStaleMs) {
    return { safe: false, reason: `Inbox monitoring is delayed (last sync ${Math.round(ageMs / 60000)}m ago)` };
  }
  return { safe: true };
}

export async function checkInbox(): Promise<ImapState> {
  if (!imapConfigured) throw new Error("IMAP isn't configured.");
  const state = await getImapState();
  const domain = messageIdDomain();
  const client = new ImapFlow({
    host: env.IMAP_HOST!,
    port: env.IMAP_PORT,
    secure: true,
    auth: { user: env.IMAP_USER!, pass: env.IMAP_PASS! },
    logger: false,
  });

  let bounces = 0;
  let replies = 0;
  try {
    await client.connect();
    const mailbox = await client.mailboxOpen("INBOX", { readOnly: true });
    const uidValidity = String(mailbox.uidValidity);
    const resume = state.uidValidity === uidValidity && state.lastUid;

    const range = resume
      ? { uid: `${state.lastUid! + 1}:*` }
      : { since: new Date(Date.now() - FIRST_RUN_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) };
    const uids = ((await client.search(range, { uid: true })) || []).filter((u) => !resume || u > state.lastUid!).slice(0, MAX_MESSAGES_PER_RUN);

    let lastUid = resume ? state.lastUid! : 0;
    for (const uid of uids) {
      const msg = await client.fetchOne(String(uid), { source: true, size: true }, { uid: true });
      if (msg && msg.source && (msg.size ?? 0) <= MAX_MESSAGE_BYTES) {
        const outcome = await applyClassification(toIncoming(await simpleParser(msg.source)), domain);
        if (outcome === "bounce") bounces++;
        if (outcome === "reply") replies++;
      }
      lastUid = Math.max(lastUid, uid);
    }

    const next: ImapState = {
      uidValidity,
      lastUid: lastUid || (mailbox.uidNext ? mailbox.uidNext - 1 : 0),
      lastCheckedAt: new Date().toISOString(),
      lastError: null,
      processed: { bounces: (state.processed?.bounces ?? 0) + bounces, replies: (state.processed?.replies ?? 0) + replies },
    };
    await saveImapState(next);
    return next;
  } catch (err) {
    const failed: ImapState = { ...state, lastCheckedAt: new Date().toISOString(), lastError: (err as Error).message.slice(0, 300) };
    await saveImapState(failed);
    throw err;
  } finally {
    await client.logout().catch(() => undefined);
  }
}

export class InboxMonitor {
  private timer: NodeJS.Timeout | null = null;
  private busy = false;

  start() {
    if (!imapConfigured || !env.IMAP_POLL_ENABLED || this.timer) return;
    const run = async () => {
      if (this.busy) return;
      this.busy = true;
      try {
        await checkInbox();
      } catch (err) {
        console.error("[inbox] check failed:", (err as Error).message);
      } finally {
        this.busy = false;
      }
    };
    void run();
    this.timer = setInterval(run, env.IMAP_POLL_INTERVAL_SECONDS * 1000);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

// exported for tests
export { applyClassification as _applyClassification };
