// Overview, mailbox status, and activity
import { Router } from "express";
import prisma from "../db.js";
import { env, imapConfigured, liveSendingBlocker, smtpConfigured } from "../config.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { ok, okPage, skipTake } from "../lib/http.js";
import { summarize } from "../lib/activity.js";
import { campaignSummaryInclude, toCampaignSummaries } from "../lib/serialize.js";
import { sentInLast24h } from "../services/send-worker.js";
import { verifyMailbox } from "../services/mailer.js";
import { checkInbox, getImapState } from "../services/inbox-monitor.js";
import { PaginationQuerySchema, type ActivityDto, type MailboxStatusDto, type OverviewDto } from "../../shared/types.js";

let cachedOverview: { data: OverviewDto; expiresAt: number } | null = null;
const OVERVIEW_CACHE_TTL_MS = 15_000;

export function invalidateOverviewCache(): void {
  cachedOverview = null;
}

export const overviewRouter = Router();

overviewRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const now = Date.now();
    if (cachedOverview && cachedOverview.expiresAt > now) {
      return ok(res, cachedOverview.data);
    }

    const since30 = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const [countsRaw, sent24h, active, recent, attention, last30] = await Promise.all([
      prisma.$queryRaw<{ contacts: bigint; lists: bigint; templates: bigint; suppressed: bigint }[]>`
        SELECT
          (SELECT COUNT(*) FROM contacts) AS contacts,
          (SELECT COUNT(*) FROM contact_lists) AS lists,
          (SELECT COUNT(*) FROM templates) AS templates,
          (SELECT COUNT(*) FROM suppression_entries) AS suppressed`,
      sentInLast24h(),
      prisma.campaign.findMany({ where: { status: { in: ["PENDING_APPROVAL", "APPROVED", "SENDING", "PAUSED"] } }, include: campaignSummaryInclude, orderBy: { updatedAt: "desc" } }),
      prisma.campaign.findMany({ where: { status: { in: ["DRAFT", "COMPLETED", "CANCELLED"] } }, include: campaignSummaryInclude, orderBy: { updatedAt: "desc" }, take: 5 }),
      prisma.send.groupBy({ by: ["campaignId", "status"], where: { status: { in: ["FAILED", "UNKNOWN"] } }, _count: { _all: true } }),
      prisma.$queryRaw<{ sent: bigint; bounced: bigint; replied: bigint; unsubscribed: bigint }[]>`
        SELECT COUNT(*) FILTER (WHERE status = 'SENT') AS sent, COUNT("bouncedAt") AS bounced,
               COUNT("repliedAt") AS replied, COUNT("unsubscribedAt") AS unsubscribed
        FROM sends WHERE "sentAt" > ${since30}`,
    ]);

    const countsRow = countsRaw[0] ?? { contacts: 0n, lists: 0n, templates: 0n, suppressed: 0n };
    const counts = {
      contacts: Number(countsRow.contacts),
      lists: Number(countsRow.lists),
      templates: Number(countsRow.templates),
      suppressed: Number(countsRow.suppressed),
    };

    const activeSummaries = await toCampaignSummaries(active);
    const issueByCampaign = new Map<string, { failed: number; unknown: number }>();
    for (const row of attention) {
      const entry = issueByCampaign.get(row.campaignId) ?? { failed: 0, unknown: 0 };
      if (row.status === "FAILED") entry.failed += row._count._all;
      else entry.unknown += row._count._all;
      issueByCampaign.set(row.campaignId, entry);
    }
    const names = await prisma.campaign.findMany({ where: { id: { in: [...issueByCampaign.keys()] } }, select: { id: true, name: true } });

    const t = last30[0];
    const data: OverviewDto = {
      counts,
      mailbox: { smtpConfigured, liveSendingEnabled: !liveSendingBlocker(), liveSendingBlocker: liveSendingBlocker(), dailyLimit: env.DAILY_SEND_LIMIT, sentLast24h: sent24h },
      awaitingApproval: activeSummaries.filter((c) => c.status === "PENDING_APPROVAL"),
      inProgress: activeSummaries.filter((c) => c.status !== "PENDING_APPROVAL"),
      needsAttention: names.map((c) => ({ campaign: c, ...issueByCampaign.get(c.id)! })),
      recent: await toCampaignSummaries(recent),
      last30Days: { sent: Number(t?.sent ?? 0), bounced: Number(t?.bounced ?? 0), replied: Number(t?.replied ?? 0), unsubscribed: Number(t?.unsubscribed ?? 0) },
    };

    cachedOverview = { data, expiresAt: now + OVERVIEW_CACHE_TTL_MS };
    ok(res, data);
  })
);

export const mailboxRouter = Router();

mailboxRouter.get(
  "/",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    const imap = await getImapState();
    const data: MailboxStatusDto = {
      smtp: {
        configured: smtpConfigured,
        host: env.SMTP_HOST ?? null,
        port: env.SMTP_PORT,
        secure: env.SMTP_SECURE,
        user: env.SMTP_USER ?? null,
        fromEmail: env.SMTP_FROM_EMAIL ?? null,
        fromName: env.SMTP_FROM_NAME,
      },
      imap: {
        configured: imapConfigured,
        enabled: imapConfigured && env.IMAP_POLL_ENABLED,
        host: env.IMAP_HOST ?? null,
        port: env.IMAP_PORT,
        lastCheckedAt: imap.lastCheckedAt ?? null,
        lastError: imap.lastError ?? null,
        unmatchedReplies: imap.unmatchedReplies ?? [],
      },
      liveSendingEnabled: !liveSendingBlocker(),
      liveSendingBlocker: liveSendingBlocker(),
      dailyLimit: env.DAILY_SEND_LIMIT,
      sentLast24h: await sentInLast24h(),
      publicUrl: env.PUBLIC_URL,
    };
    ok(res, data);
  })
);

/** Signs in to SMTP to check the credentials. Sends nothing. */
mailboxRouter.post(
  "/test-smtp",
  requirePermission("settings.view"),
  asyncHandler(async (_req, res) => {
    try {
      await verifyMailbox();
    } catch (err) {
      throw AppError.badRequest("SMTP_CONNECTION_FAILED", `Couldn't sign in to ${env.SMTP_HOST ?? "the mailbox"}: ${(err as Error).message}`);
    }
    ok(res, { ok: true });
  })
);

/** Reads the inbox once now (read-only) for bounces and replies */
mailboxRouter.post(
  "/check-inbox",
  requirePermission("settings.manage"),
  asyncHandler(async (_req, res) => {
    if (!imapConfigured) throw AppError.badRequest("IMAP_NOT_CONFIGURED", "Inbox monitoring isn't configured on the server.");
    try {
      ok(res, await checkInbox());
    } catch (err) {
      throw AppError.badRequest("IMAP_FAILED", `Couldn't read the inbox: ${(err as Error).message}`);
    }
  })
);

/** Toggles ALLOW_LIVE_SENDING on or off */
mailboxRouter.post(
  "/live-sending",
  requirePermission("campaigns.approve"),
  asyncHandler(async (req, res) => {
    const { enabled } = req.body ?? {};
    if (typeof enabled !== "boolean") {
      throw AppError.badRequest("INVALID_REQUEST", "The 'enabled' boolean is required.");
    }
    const { setLiveSending } = await import("../services/mailbox-config.js");
    const result = await setLiveSending(enabled);
    ok(res, result);
  })
);

/** Updates sender email, password, and fromName; verifies connection before saving */
mailboxRouter.post(
  "/update-account",
  requirePermission("settings.view"),
  asyncHandler(async (req, res) => {
    const { email, password, fromName } = req.body ?? {};
    if (!email) {
      throw AppError.badRequest("MISSING_CREDENTIALS", "Sender email is required.");
    }
    const { updateMailboxAccount } = await import("../services/mailbox-config.js");
    try {
      const result = await updateMailboxAccount({ email, password, fromName });
      ok(res, result);
    } catch (err) {
      throw AppError.badRequest("MAILBOX_UPDATE_FAILED", (err as Error).message);
    }
  })
);

export const activityRouter = Router();

activityRouter.get(
  "/",
  requirePermission("audit.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const where = { action: { not: "auth.login" } };
    const [rows, total] = await Promise.all([
      prisma.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, include: { user: { select: { id: true, name: true } } }, ...skipTake(page, pageSize) }),
      prisma.auditLog.count({ where }),
    ]);
    const data: ActivityDto[] = rows.map((r) => ({
      id: r.id,
      action: r.action,
      summary: summarize(r.action, r.metadata),
      entityType: r.entityType,
      entityId: r.entityId,
      user: r.user,
      createdAt: r.createdAt.toISOString(),
    }));
    okPage(res, data, page, pageSize, total);
  })
);
