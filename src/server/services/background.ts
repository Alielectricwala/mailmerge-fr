// Background work for serverless deployments (Vercel), where no process stays alive between requests.
//
// A "burst" sends for a bounded time under a database lease (so bursts never overlap), checks the
// inbox if due, and — if messages are still queued — asks for the next burst. Bursts start:
//   • right away when someone starts/resumes/retries a campaign (kickBackground)
//   • from /api/internal/tick (Vercel Cron, an external scheduler, or the previous burst)
// Self-hosted servers don't use this: they run SendWorker.start() and InboxMonitor continuously.
import { waitUntil } from "@vercel/functions";
import { env, imapConfigured, isServerless } from "../config.js";
import { acquireLease, hasQueuedWork, recoverInterruptedSends, releaseLease, SendWorker } from "./send-worker.js";
import { checkInbox, getImapState } from "./inbox-monitor.js";

// Must stay below the function's maxDuration (vercel.json: 300s) with room for one SMTP handoff
const BURST_MS = 240_000;
const LEASE_MS = BURST_MS + 90_000;
// Older than any function can live: safe to call these interrupted
const STALE_CLAIM_MS = 15 * 60_000;

export interface BurstResult {
  ran: boolean;
  reason?: string;
  handled?: number;
  stoppedBecause?: string;
  inboxChecked?: boolean;
  more?: boolean;
}

async function inboxDue(): Promise<boolean> {
  if (!imapConfigured || !env.IMAP_POLL_ENABLED) return false;
  const state = await getImapState();
  const last = state.lastCheckedAt ? new Date(state.lastCheckedAt).getTime() : 0;
  return Date.now() - last >= env.IMAP_POLL_INTERVAL_SECONDS * 1000;
}

export async function runBurst(budgetMs = BURST_MS): Promise<BurstResult> {
  await recoverInterruptedSends(STALE_CLAIM_MS);
  const owner = await acquireLease("sender", LEASE_MS);
  if (!owner) return { ran: false, reason: "Another burst is already running." };

  try {
    let inboxChecked = false;
    if (await inboxDue()) {
      await checkInbox().catch((err) => console.error("[inbox] check failed:", (err as Error).message));
      inboxChecked = true;
    }
    const { handled, stoppedBecause } = await new SendWorker().runFor(budgetMs);
    // More to do and not blocked by the daily limit -> keep going without waiting for cron
    const more = stoppedBecause === "budget" && (await hasQueuedWork());
    return { ran: true, handled, stoppedBecause, inboxChecked, more };
  } finally {
    await releaseLease("sender", owner);
  }
}

/**
 * Asks the production deployment for another burst (a separate invocation with a fresh time limit).
 * Uses PUBLIC_URL — the per-deployment VERCEL_URL can sit behind Deployment Protection.
 * Preview deployments never chain, so they can't drive sending.
 */
async function requestNextBurst() {
  if (process.env.VERCEL_ENV && process.env.VERCEL_ENV !== "production") return;
  if (!env.CRON_SECRET) {
    console.warn("[background] CRON_SECRET is not set; remaining messages wait for the next scheduled tick.");
    return;
  }
  await fetch(`${env.PUBLIC_URL.replace(/\/$/, "")}/api/internal/tick`, {
    method: "POST",
    headers: { Authorization: `Bearer ${env.CRON_SECRET}` },
  }).catch((err) => console.error("[background] couldn't request the next burst:", (err as Error).message));
}

/** Runs a burst after the current response is sent, and chains the next one if needed */
export function runBurstInBackground() {
  waitUntil(
    runBurst()
      .then((result) => (result.more ? requestNextBurst() : undefined))
      .catch((err) => console.error("[background] burst failed:", (err as Error).message))
  );
}

/** Call after anything that creates sendable work. No-op on self-hosted servers (the loop handles it). */
export function kickBackground() {
  if (isServerless) runBurstInBackground();
}
