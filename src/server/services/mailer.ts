// Outgoing mail transport (SpaceMail SMTP via nodemailer), behind an interface so tests can use a fake.
import nodemailer from "nodemailer";
import { env, smtpConfigured } from "../config.js";

export interface OutgoingMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** Full RFC 5322 Message-ID including angle brackets */
  messageId?: string;
  fromName: string;
  fromEmail?: string | null;
  replyTo?: string | null;
  headers?: Record<string, string>;
}

export interface MailTransport {
  send(message: OutgoingMessage): Promise<{ response: string }>;
  verify(): Promise<void>;
  close(): void;
}

class SmtpTransport implements MailTransport {
  private readonly transporter = nodemailer.createTransport({
    host: env.SMTP_HOST,
    port: env.SMTP_PORT,
    secure: env.SMTP_SECURE,
    auth: { user: env.SMTP_USER!, pass: env.SMTP_PASS! },
    pool: true,
    maxConnections: 1, // one mailbox: keep it to a single connection; the worker paces sending
    connectionTimeout: 15_000,
    greetingTimeout: 10_000,
    socketTimeout: 60_000,
  });

  async send(message: OutgoingMessage) {
    // SpaceMail SMTP strictly enforces that the envelope address matches the authenticated mailbox user (SMTP_USER).
    // We set envelope.from = authenticatedAddress to satisfy SpaceMail authentication without 553 rejections,
    // while displaying the employee's customized sender address and name in the email From header and Reply-To.
    const authenticatedAddress = env.SMTP_USER || env.SMTP_FROM_EMAIL!;
    const fromAddress = message.fromEmail?.trim() || authenticatedAddress;
    const effectiveReplyTo =
      message.replyTo ||
      message.fromEmail ||
      (env.SMTP_FROM_EMAIL && env.SMTP_FROM_EMAIL.toLowerCase() !== authenticatedAddress.toLowerCase()
        ? env.SMTP_FROM_EMAIL
        : undefined);

    const mailOptions = {
      from: { name: message.fromName, address: fromAddress },
      envelope: {
        from: authenticatedAddress,
        to: message.to,
      },
      to: message.to,
      replyTo: effectiveReplyTo,
      subject: message.subject,
      html: message.html,
      text: message.text,
      messageId: message.messageId,
      headers: message.headers,
    };
    const info = await this.transporter.sendMail(mailOptions);

    // Auto-save copy to IMAP Sent folder so it appears in Outlook / webmail
    if (env.IMAP_HOST && env.IMAP_USER && env.IMAP_PASS) {
      void appendToSent(mailOptions).catch((err) => {
        console.warn("[mailer] Could not append to Sent folder:", (err as Error).message);
      });
    }

    return { response: String(info.response ?? "") };
  }

  async verify() {
    await this.transporter.verify();
  }

  close() {
    this.transporter.close();
  }
}

let override: MailTransport | null = null;
let smtp: SmtpTransport | null = null;

/** Tests (and the local SMTP sink harness) can swap the transport */
export function setTransport(transport: MailTransport | null) {
  override = transport;
}

export function getTransport(): MailTransport {
  if (override) return override;
  if (!smtpConfigured) throw new Error("The sending mailbox isn't configured on the server.");
  smtp ??= new SmtpTransport();
  return smtp;
}

/** A fresh, non-pooled connection used only to check the credentials */
export async function verifyMailbox(): Promise<void> {
  if (override) return override.verify();
  if (!smtpConfigured) throw new Error("The sending mailbox isn't configured on the server.");
  const probe = new SmtpTransport();
  try {
    await probe.verify();
  } finally {
    probe.close();
  }
}

export function closeTransport() {
  smtp?.close();
  smtp = null;
}

/** Domain used for our Message-IDs, so replies and bounces can be matched back */
export function messageIdDomain(): string {
  return ((env.SMTP_USER || env.SMTP_FROM_EMAIL)?.split("@")[1] ?? "focusrealm.local").toLowerCase();
}

/** Appends a message copy to the IMAP Sent mailbox using ImapFlow */
async function appendToSent(mailOptions: Record<string, unknown>): Promise<void> {
  const { ImapFlow } = await import("imapflow");
  const MailComposer = (await import("nodemailer/lib/mail-composer/index.js")).default;
  // @ts-ignore MailComposer constructor
  const composer = new MailComposer(mailOptions);
  const raw = await composer.compile().build();

  const client = new ImapFlow({
    host: env.IMAP_HOST!,
    port: env.IMAP_PORT,
    secure: true,
    auth: { user: env.IMAP_USER!, pass: env.IMAP_PASS! },
    logger: false,
  });

  try {
    await client.connect();
    // Locate Sent folder (common names: "Sent", "INBOX.Sent", "Sent Messages", "Sent Items")
    const list = await client.list();
    const sentMailbox = list.find((m) => m.specialUse === "\\Sent" || /^sent/i.test(m.name) || /sent items/i.test(m.name))?.path || "Sent";
    await client.append(sentMailbox, raw, ["\\Seen"]);
  } finally {
    await client.logout().catch(() => undefined);
  }
}

