// Classifies an SMTP failure by what we actually know about whether the message left.
//
//   rejected   — server refused it (5xx). Not sent. Retrying won't help; may mean a bad address.
//   temporary  — server deferred it (4xx). Not sent. Safe to retry later.
//   not_sent   — couldn't connect or sign in, so it never reached the server. Safe to requeue.
//   unknown    — failed mid-handoff (e.g. timeout during DATA). It MAY have been delivered,
//                so it is never retried automatically.

export type SmtpOutcome =
  | { kind: "rejected"; message: string; badAddress: boolean }
  | { kind: "temporary"; message: string }
  | { kind: "not_sent"; message: string; authFailure: boolean }
  | { kind: "unknown"; message: string };

interface SmtpLikeError {
  code?: string;
  responseCode?: number;
  command?: string;
  response?: string;
  message?: string;
}

const CONNECT_CODES = new Set(["ECONNECTION", "ECONNREFUSED", "ENOTFOUND", "EDNS", "EAI_AGAIN", "ECONNRESET_BEFORE"]);
const BAD_ADDRESS = /user unknown|no such user|does not exist|unknown recipient|recipient (address )?rejected|mailbox (not found|unavailable)|invalid (recipient|address)|address rejected|undeliverable/i;

export function classifySmtpError(error: unknown): SmtpOutcome {
  const err = (error ?? {}) as SmtpLikeError;
  const command = (err.command ?? "").toUpperCase();
  const text = (err.response || err.message || "Unknown SMTP error").trim().slice(0, 500);

  if (err.code === "EAUTH" || command.startsWith("AUTH")) {
    return { kind: "not_sent", message: `Mailbox sign-in failed: ${text}`, authFailure: true };
  }

  if (typeof err.responseCode === "number") {
    if (err.responseCode >= 500) {
      const atRecipient = command.startsWith("RCPT");
      const isSenderRejection =
        command.startsWith("MAIL") ||
        /sender (address )?rejected|not owned by user|authenticated sender/i.test(text);

      return {
        kind: "rejected",
        message: text,
        badAddress: !isSenderRejection && (atRecipient || BAD_ADDRESS.test(text)),
      };
    }
    if (err.responseCode >= 400) return { kind: "temporary", message: text };
  }

  // No SMTP reply: did it fail before or after the message was handed over?
  if (err.code && CONNECT_CODES.has(err.code)) return { kind: "not_sent", message: text, authFailure: false };
  if (command === "CONN" || command === "EHLO" || command === "HELO" || command === "STARTTLS") {
    return { kind: "not_sent", message: text, authFailure: false };
  }
  if (err.code === "EENVELOPE") return { kind: "rejected", message: text, badAddress: true };

  return { kind: "unknown", message: text };
}
