// FocusRealm Mail Merge — server entry: HTTP + sending worker + inbox monitor
import "dotenv/config";
import { env, imapConfigured, liveSendingBlocker, smtpConfigured } from "./config.js";
import { createApp } from "./app.js";
import prisma from "./db.js";
import { recoverInterruptedSends, SendWorker } from "./services/send-worker.js";
import { InboxMonitor } from "./services/inbox-monitor.js";
import { closeTransport } from "./services/mailer.js";

export const worker = new SendWorker();
export function wakeWorker() {
  worker.wake();
}
const inbox = new InboxMonitor();

async function main() {
  await prisma.$connect();
  const recovered = await recoverInterruptedSends();
  if (recovered) console.warn(`[worker] ${recovered} message(s) were interrupted mid-send last time; marked UNKNOWN for review.`);

  const server = createApp().listen(env.PORT, env.HOST, () => {
    console.log(`FocusRealm Mail Merge API on http://${env.HOST}:${env.PORT} (${env.NODE_ENV})`);
    console.log(`  Mailbox: ${smtpConfigured ? env.SMTP_FROM_EMAIL : "not configured"} · Live sending: ${liveSendingBlocker() ? "off" : "on"} · Inbox monitor: ${imapConfigured && env.IMAP_POLL_ENABLED ? "on" : "off"}`);
  });
  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Port ${env.PORT} is already in use. Stop the other process or set PORT in .env.`);
      process.exit(1);
    }
    throw err;
  });

  worker.start();
  inbox.start();

  const shutdown = async (signal: string) => {
    console.log(`${signal} received, shutting down…`);
    const force = setTimeout(() => process.exit(1), 15_000);
    inbox.stop();
    await worker.stop(); // lets an in-flight send finish and be recorded
    closeTransport();
    server.close();
    await prisma.$disconnect();
    clearTimeout(force);
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

main().catch(async (err) => {
  console.error("Failed to start:", err instanceof Error ? err.message : err);
  await prisma.$disconnect().catch(() => undefined);
  process.exit(1);
});
