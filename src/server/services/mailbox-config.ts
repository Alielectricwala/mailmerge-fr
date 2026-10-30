import fs from "fs/promises";
import path from "path";
import nodemailer from "nodemailer";
import { env } from "../config.js";
import { closeTransport } from "./mailer.js";

export interface UpdateMailboxAccountInput {
  email: string;
  password?: string;
  fromName?: string;
}

/**
 * Updates ALLOW_LIVE_SENDING in memory and on disk (.env).
 */
export async function setLiveSending(enabled: boolean): Promise<{ success: boolean; allowLiveSending: boolean }> {
  env.ALLOW_LIVE_SENDING = enabled;

  const envPath = path.resolve(process.cwd(), ".env");
  try {
    let content = await fs.readFile(envPath, "utf-8");
    const regex = new RegExp(`^ALLOW_LIVE_SENDING=.*$`, "m");
    const formattedVal = enabled ? "true" : "false";
    if (regex.test(content)) {
      content = content.replace(regex, `ALLOW_LIVE_SENDING=${formattedVal}`);
    } else {
      content += `\nALLOW_LIVE_SENDING=${formattedVal}`;
    }
    await fs.writeFile(envPath, content, "utf-8");
  } catch (err) {
    console.warn("[mailbox-config] Could not write ALLOW_LIVE_SENDING to .env:", (err as Error).message);
  }

  return { success: true, allowLiveSending: env.ALLOW_LIVE_SENDING };
}

/**
 * Verifies SpaceMail credentials (if password provided) or updates sender display name,
 * persists to .env on disk, updates in-memory config, and resets the SMTP transport.
 */
export async function updateMailboxAccount(input: UpdateMailboxAccountInput): Promise<{ success: boolean; email: string; fromName: string }> {
  const email = input.email.trim().toLowerCase();
  const password = input.password?.trim();
  const fromName = input.fromName?.trim() || env.SMTP_FROM_NAME || "FocusRealm";

  if (!email) {
    throw new Error("Sender email is required.");
  }

  // 1. If password is provided, verify credentials with SMTP server before persisting
  if (password) {
    const probe = nodemailer.createTransport({
      host: env.SMTP_HOST || "mail.spacemail.com",
      port: env.SMTP_PORT || 465,
      secure: env.SMTP_SECURE,
      auth: { user: email, pass: password },
      connectionTimeout: 15_000,
    });

    try {
      await probe.verify();
    } catch (err) {
      throw new Error(`Authentication failed for ${email} on ${env.SMTP_HOST || "mail.spacemail.com"}: ${(err as Error).message}`);
    } finally {
      probe.close();
    }
  }

  // 2. Update .env file on disk
  const envPath = path.resolve(process.cwd(), ".env");
  try {
    let content = await fs.readFile(envPath, "utf-8");

    const replaceOrAppend = (key: string, val: string) => {
      const regex = new RegExp(`^${key}=.*$`, "m");
      const formattedVal = val.includes("#") || val.includes(" ") ? `'${val}'` : val;
      if (regex.test(content)) {
        content = content.replace(regex, `${key}=${formattedVal}`);
      } else {
        content += `\n${key}=${formattedVal}`;
      }
    };

    replaceOrAppend("SMTP_FROM_EMAIL", email);
    replaceOrAppend("SMTP_FROM_NAME", fromName);

    if (password) {
      replaceOrAppend("SMTP_USER", email);
      replaceOrAppend("SMTP_PASS", password);
      replaceOrAppend("IMAP_USER", email);
      replaceOrAppend("IMAP_PASS", password);
    }

    await fs.writeFile(envPath, content, "utf-8");
  } catch (err) {
    console.warn("[mailbox-config] Could not write to .env file:", (err as Error).message);
  }

  // 3. Update in-memory configuration
  env.SMTP_FROM_EMAIL = email;
  env.SMTP_FROM_NAME = fromName;
  if (password) {
    env.SMTP_USER = email;
    env.SMTP_PASS = password;
    env.IMAP_USER = email;
    env.IMAP_PASS = password;
  }

  // 4. Invalidate cached nodemailer transporter so it reconnects with new user
  closeTransport();

  return { success: true, email, fromName };
}
