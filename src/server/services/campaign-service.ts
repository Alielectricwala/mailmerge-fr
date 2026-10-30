// Campaign lifecycle & business rules.
//
//   DRAFT ──request──▶ PENDING_APPROVAL ──approve (founder)──▶ APPROVED ──start──▶ SENDING ⇄ PAUSED ──▶ COMPLETED
//     ▲                       │ withdraw / request changes                                  │
//     └───────────────────────┘                                   cancel (any non-final) ──▶ CANCELLED
//
// Approval re-checks every recipient, then freezes one Send row per recipient with the exact
// rendered message (footer included). From then on, template edits can't change what goes out.
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import type { Request } from "express";
import prisma from "../db.js";
import { AppError } from "../middleware/error-handler.js";
import { audit } from "../lib/audit.js";
import { liveSendingBlocker, smtpConfigured } from "../config.js";
import { contactMergeData, htmlToText, renderEmail, validateTemplate, type TemplateParts } from "../../shared/merge.js";
import { FOUNDER_SELF_APPROVAL_ALLOWED } from "../../shared/auth.js";
import { SUPPRESSION_REASON_LABELS, type CampaignReviewDto, type CampaignStatus } from "../../shared/types.js";
import { getTransport, messageIdDomain } from "./mailer.js";
import { unsubscribeHeaders, unsubscribeUrl, withFooter } from "./unsubscribe.js";

import { selectTemplateForRecipient, type EligibleTemplate, type SelectionRule } from "./template-selection.js";
import { initializeRecipientStates } from "./sequence-service.js";

type Tx = Prisma.TransactionClient;

export function contentHash(parts: TemplateParts): string {
  return crypto.createHash("sha256").update(JSON.stringify([parts.subject, parts.bodyHtml, parts.bodyText ?? ""])).digest("hex").slice(0, 16);
}

export function multiTemplateContentHash(templates: EligibleTemplate[], rules: SelectionRule[] = [], overridesCount = 0): string {
  if (templates.length === 1 && rules.length === 0 && overridesCount === 0) {
    const t = templates[0]!;
    return contentHash({ subject: t.subject, bodyHtml: t.bodyHtml, bodyText: t.bodyText });
  }
  const parts = templates.map((t) => [t.id, t.version, t.subject, t.bodyHtml, t.bodyText ?? "", t.isFallback ? 1 : 0]);
  const ruleParts = rules.map((r) => [r.id, r.priority, r.templateId, r.hotelSegment ?? "", r.contactPersona ?? "", r.requiresVerified ? 1 : 0, r.minConfidence ?? 0, r.city ?? ""]);
  return crypto.createHash("sha256").update(JSON.stringify([parts, ruleParts, overridesCount])).digest("hex").slice(0, 16);
}

async function getCampaignOr404(id: string, db: Tx | typeof prisma = prisma) {
  const campaign = await db.campaign.findUnique({
    where: { id },
    include: {
      template: true,
      campaignTemplates: { include: { template: true }, orderBy: { priority: "asc" } },
      rules: { include: { template: true }, orderBy: { priority: "asc" } },
      recipientOverrides: { include: { template: true } },
      sequenceSteps: { include: { template: true }, orderBy: { stepIndex: "asc" } },
    },
  });
  if (!campaign) throw AppError.notFound("CAMPAIGN_NOT_FOUND", "That campaign no longer exists.");
  return campaign;
}

/** Atomic status transition: fails if another request changed the status first */
async function transition(db: Tx | typeof prisma, id: string, from: CampaignStatus[], data: Prisma.CampaignUncheckedUpdateManyInput, conflictMessage: string) {
  const result = await db.campaign.updateMany({ where: { id, status: { in: from } }, data });
  if (result.count !== 1) throw AppError.conflict("INVALID_STATUS", conflictMessage);
}

// ---------------------------------------------------------------------------
// Review (live check against the current templates, rules and list)
// ---------------------------------------------------------------------------

interface ReadyRecipient {
  contactId: string;
  email: string;
  rendered: ReturnType<typeof renderEmail>;
  templateId: string;
  templateVersion: number;
  templateName: string;
  assignmentSource: "OVERRIDE" | "RULE" | "FALLBACK";
  assignmentReason: string;
  isCustom?: boolean;
}

interface SkippedRecipient {
  contactId: string;
  email: string;
  reason: string;
  templateId?: string;
  templateVersion?: number;
  assignmentReason?: string;
}

interface ReviewWork {
  review: CampaignReviewDto & { contentHash: string };
  ready: ReadyRecipient[];
  skipped: SkippedRecipient[];
}

export async function buildReview(campaignId: string, db: Tx | typeof prisma = prisma, sampleSize = 5): Promise<ReviewWork> {
  const campaign = await getCampaignOr404(campaignId, db);

  const eligibleTemplates: EligibleTemplate[] = campaign.campaignTemplates.length
    ? campaign.campaignTemplates.map((ct) => ({
        id: ct.template.id,
        name: ct.template.name,
        subject: ct.template.subject,
        bodyHtml: ct.template.bodyHtml,
        bodyText: ct.template.bodyText,
        version: ct.template.version,
        isFallback: ct.isFallback,
      }))
    : [
        {
          id: campaign.template.id,
          name: campaign.template.name,
          subject: campaign.template.subject,
          bodyHtml: campaign.template.bodyHtml,
          bodyText: campaign.template.bodyText,
          version: campaign.template.version,
          isFallback: true,
        },
      ];

  const templateErrors: string[] = [];
  for (const t of eligibleTemplates) {
    const errs = validateTemplate({ subject: t.subject, bodyHtml: t.bodyHtml, bodyText: t.bodyText });
    for (const e of errs) templateErrors.push(`[${t.name}] ${e}`);
  }

  const rules: SelectionRule[] = campaign.rules.map((r) => ({
    id: r.id,
    templateId: r.templateId,
    priority: r.priority,
    hotelSegment: r.hotelSegment,
    contactPersona: r.contactPersona,
    requiresVerified: r.requiresVerified,
    minConfidence: r.minConfidence,
    city: r.city,
    description: r.description,
  }));

  const overridesMap = new Map(
    campaign.recipientOverrides.map((o) => [o.contactId, { contactId: o.contactId, templateId: o.templateId, reason: o.reason }])
  );
  const customOverridesMap = new Map(
    campaign.recipientOverrides.map((o) => [o.contactId, o])
  );

  const members = await db.listMembership.findMany({
    where: { contactListId: campaign.contactListId },
    include: { contact: true },
    orderBy: { addedAt: "asc" },
  });
  const emails = members.map((m) => m.contact.email);
  const suppressions = emails.length ? await db.suppressionEntry.findMany({ where: { email: { in: emails } } }) : [];
  const suppressedBy = new Map(suppressions.filter((s) => !s.expiresAt || s.expiresAt > new Date()).map((s) => [s.email.toLowerCase(), s.reason]));

  const selectionContext = {
    templates: eligibleTemplates,
    rules,
    overrides: overridesMap,
    defaultTemplateId: campaign.templateId,
  };

  const countsByTemplate = new Map<string, number>();
  for (const t of eligibleTemplates) countsByTemplate.set(t.id, 0);

  const work: ReviewWork = {
    review: {
      total: members.length,
      ready: 0,
      templateErrors,
      missingFields: [],
      suppressed: [],
      issueCount: 0,
      sample: [],
      templateBreakdown: [],
      rulesCount: rules.length,
      contentHash: multiTemplateContentHash(eligibleTemplates, rules, campaign.recipientOverrides.length),
    },
    ready: [],
    skipped: [],
  };

  for (const { contact } of members) {
    const reason = suppressedBy.get(contact.email.toLowerCase());
    if (reason) {
      const label = `Suppressed: ${SUPPRESSION_REASON_LABELS[reason]}`;
      work.review.suppressed.push({ email: contact.email, contactId: contact.id, reason: label });
      work.skipped.push({ contactId: contact.id, email: contact.email, reason: label });
      continue;
    }

    const selection = selectTemplateForRecipient(
      {
        id: contact.id,
        email: contact.email,
        firstName: contact.firstName,
        lastName: contact.lastName,
        company: contact.company,
        title: contact.title,
        hotelSegment: contact.hotelSegment,
        hotelSegmentConfidence: contact.hotelSegmentConfidence,
        hotelSegmentStatus: contact.hotelSegmentStatus,
        contactPersona: contact.contactPersona,
        contactPersonaConfidence: contact.contactPersonaConfidence,
        contactPersonaStatus: contact.contactPersonaStatus,
        customFields:
          typeof contact.customFields === "object" && contact.customFields !== null
            ? (contact.customFields as Record<string, string>)
            : {},
      },
      selectionContext
    );

    const customOverride = customOverridesMap.get(contact.id);
    let rendered: ReturnType<typeof renderEmail>;
    let targetTemplateId = selection.templateId;
    let targetTemplateVersion = selection.template.version;
    let targetTemplateName = selection.templateName;
    let assignmentSource = selection.assignmentSource;
    let assignmentReason = selection.explanation;
    let isCustom = false;

    if (customOverride && customOverride.isCustom && customOverride.customSubject && customOverride.customBodyHtml) {
      rendered = {
        subject: customOverride.customSubject,
        html: customOverride.customBodyHtml,
        text: customOverride.customBodyText || htmlToText(customOverride.customBodyHtml),
        missingFields: [],
      };
      assignmentSource = "OVERRIDE";
      assignmentReason = customOverride.reason || "Customized by user";
      isCustom = true;
      if (customOverride.template) {
        targetTemplateId = customOverride.template.id;
        targetTemplateVersion = customOverride.template.version;
        targetTemplateName = customOverride.template.name;
      }
    } else {
      const parts: TemplateParts = {
        subject: selection.template.subject,
        bodyHtml: selection.template.bodyHtml,
        bodyText: selection.template.bodyText,
      };
      rendered = renderEmail(parts, contactMergeData(contact));
    }

    if (rendered.missingFields.length) {
      work.review.missingFields.push({ email: contact.email, contactId: contact.id, fields: rendered.missingFields });
      work.skipped.push({
        contactId: contact.id,
        email: contact.email,
        reason: `Missing: ${rendered.missingFields.join(", ")}`,
        templateId: targetTemplateId,
        templateVersion: targetTemplateVersion,
        assignmentReason,
      });
      continue;
    }

    countsByTemplate.set(targetTemplateId, (countsByTemplate.get(targetTemplateId) ?? 0) + 1);

    work.ready.push({
      contactId: contact.id,
      email: contact.email,
      rendered,
      templateId: targetTemplateId,
      templateVersion: targetTemplateVersion,
      templateName: targetTemplateName,
      assignmentSource,
      assignmentReason,
      isCustom,
    });
  }

  work.review.ready = work.ready.length;
  work.review.issueCount = work.review.missingFields.length + work.review.suppressed.length;
  work.review.templateBreakdown = eligibleTemplates.map((t) => ({
    templateId: t.id,
    templateName: t.name,
    count: countsByTemplate.get(t.id) ?? 0,
    isFallback: Boolean(t.isFallback),
  }));

  work.review.sample = work.ready.slice(0, sampleSize).map((r) => ({
    contactId: r.contactId,
    email: r.email,
    subject: r.rendered.subject,
    html: r.rendered.html,
    text: r.rendered.text,
    missingFields: [],
    templateId: r.templateId,
    templateName: r.templateName,
    assignmentSource: r.assignmentSource,
    assignmentReason: r.assignmentReason,
    isCustom: r.isCustom,
  }));

  // Show at least one problem recipient's render when nobody is ready
  if (!work.review.sample.length && members[0]) {
    const defaultTemplate = eligibleTemplates[0]!;
    const r = renderEmail(
      { subject: defaultTemplate.subject, bodyHtml: defaultTemplate.bodyHtml, bodyText: defaultTemplate.bodyText },
      contactMergeData(members[0].contact)
    );
    work.review.sample.push({
      contactId: members[0].contact.id,
      email: members[0].contact.email,
      subject: r.subject,
      html: r.html,
      text: r.text,
      missingFields: r.missingFields,
      templateId: defaultTemplate.id,
      templateName: defaultTemplate.name,
      assignmentSource: "FALLBACK",
      assignmentReason: "Sample problem render",
    });
  }
  return work;
}

export async function reviewCampaign(id: string) {
  return (await buildReview(id)).review;
}

// ---------------------------------------------------------------------------
// Draft editing
// ---------------------------------------------------------------------------

export async function assertEditable(id: string) {
  const c = await getCampaignOr404(id);
  if (c.status !== "DRAFT") {
    throw AppError.conflict("NOT_EDITABLE", c.status === "PENDING_APPROVAL" ? "Withdraw the approval request before editing." : "Only draft campaigns can be edited.");
  }
  return c;
}

// ---------------------------------------------------------------------------
// Approval flow
// ---------------------------------------------------------------------------

export async function requestApproval(req: Request, id: string) {
  const work = await buildReview(id);
  if (work.review.templateErrors.length) {
    throw AppError.badRequest("TEMPLATE_INVALID", `Fix the template first: ${work.review.templateErrors[0]}`);
  }
  if (work.review.ready === 0) {
    throw AppError.badRequest("NO_RECIPIENTS", work.review.total === 0 ? "The recipient list is empty." : "No recipient can receive this email yet. Fix the issues shown in the review.");
  }
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, ["DRAFT"], { status: "PENDING_APPROVAL", approvalRequestedById: req.user!.id, approvalRequestedAt: new Date() }, "Only drafts can be submitted for approval.");
    await audit(req, { action: "campaign.request_approval", entityType: "Campaign", entityId: id, metadata: { ready: work.review.ready, issues: work.review.issueCount } }, tx);
  });
}

export async function withdrawApproval(req: Request, id: string, note?: string) {
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, ["PENDING_APPROVAL"], { status: "DRAFT", approvalRequestedById: null, approvalRequestedAt: null }, "This campaign isn't waiting for approval.");
    await audit(req, { action: "campaign.return_to_draft", entityType: "Campaign", entityId: id, metadata: note ? { note } : {} }, tx);
  });
}

export async function approveCampaign(req: Request, id: string, seen: { contentHash: string; ready: number }) {
  const user = req.user!;
  await prisma.$transaction(
    async (tx) => {
      const campaign = await getCampaignOr404(id, tx);
      if (campaign.status !== "PENDING_APPROVAL") throw AppError.conflict("INVALID_STATUS", "This campaign isn't waiting for approval.");
      if (!FOUNDER_SELF_APPROVAL_ALLOWED && campaign.approvalRequestedById === user.id) {
        throw AppError.forbidden("SELF_APPROVAL", "Another founder must approve a campaign you submitted.");
      }

      const work = await buildReview(id, tx);
      if (work.review.contentHash !== seen.contentHash || work.review.ready !== seen.ready) {
        throw AppError.conflict("REVIEW_STALE", "The template or recipient list changed since you reviewed it. Review it again before approving.");
      }
      if (work.review.templateErrors.length || work.review.ready === 0) {
        throw AppError.badRequest("NOT_READY", "This campaign has no recipients ready to receive it.");
      }

      await transition(
        tx,
        id,
        ["PENDING_APPROVAL"],
        {
          status: "APPROVED",
          approvedById: user.id,
          approvedAt: new Date(),
          subject: campaign.template.subject,
          bodyHtml: campaign.template.bodyHtml,
          bodyText: campaign.template.bodyText,
          contentHash: work.review.contentHash,
        },
        "This campaign isn't waiting for approval."
      );

      const domain = messageIdDomain();
      const rows: Prisma.SendCreateManyInput[] = work.ready.map((r) => {
        const sendId = crypto.randomUUID();
        const content = withFooter(r.rendered.html, r.rendered.text, unsubscribeUrl(sendId), campaign.fromName);
        return {
          id: sendId,
          campaignId: id,
          contactId: r.contactId,
          email: r.email,
          subject: r.rendered.subject,
          html: content.html,
          text: content.text,
          messageId: `<${sendId}@${domain}>`,
          status: "PENDING",
          templateId: r.templateId,
          templateVersion: r.templateVersion,
          assignmentReason: r.assignmentReason,
          stepIndex: 0,
          scheduledFor: new Date(),
          approvedAt: new Date(),
        };
      });
      for (const s of work.skipped) {
        const sendId = crypto.randomUUID();
        rows.push({
          id: sendId,
          campaignId: id,
          contactId: s.contactId,
          email: s.email,
          subject: "",
          html: "",
          text: "",
          messageId: `<${sendId}@${domain}>`,
          status: "SKIPPED",
          skipReason: s.reason,
          templateId: s.templateId ?? null,
          templateVersion: s.templateVersion ?? null,
          assignmentReason: s.assignmentReason ?? null,
          stepIndex: 0,
        });
      }
      for (let i = 0; i < rows.length; i += 1000) {
        await tx.send.createMany({ data: rows.slice(i, i + 1000), skipDuplicates: true });
      }

      await initializeRecipientStates(id, work.ready, tx);

      await audit(req, { action: "campaign.approve", entityType: "Campaign", entityId: id, metadata: { recipients: work.ready.length, skipped: work.skipped.length } }, tx);
    },
    { timeout: 120_000, maxWait: 10_000 }
  );
}

// ---------------------------------------------------------------------------
// Sending control
// ---------------------------------------------------------------------------

export async function startCampaign(req: Request, id: string) {
  const blocker = liveSendingBlocker();
  if (blocker) throw AppError.conflict("LIVE_SENDING_LOCKED", blocker);
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, ["APPROVED"], { status: "SENDING", startedAt: new Date(), pausedReason: null }, "Only approved campaigns can be started.");
    await audit(req, { action: "campaign.start", entityType: "Campaign", entityId: id }, tx);
  });
}

export async function pauseCampaign(req: Request | null, id: string, reason?: string) {
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, ["SENDING"], { status: "PAUSED", pausedReason: reason ?? null }, "Only a campaign that is sending can be paused.");
    await audit(req, { action: reason ? "campaign.auto_pause" : "campaign.pause", entityType: "Campaign", entityId: id, metadata: reason ? { reason } : {} }, tx);
  });
}

export async function resumeCampaign(req: Request, id: string) {
  const blocker = liveSendingBlocker();
  if (blocker) throw AppError.conflict("LIVE_SENDING_LOCKED", blocker);
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, ["PAUSED"], { status: "SENDING", pausedReason: null }, "Only a paused campaign can be resumed.");
    await audit(req, { action: "campaign.resume", entityType: "Campaign", entityId: id }, tx);
  });
}

export async function cancelCampaign(req: Request, id: string) {
  await prisma.$transaction(async (tx) => {
    await transition(tx, id, ["DRAFT", "PENDING_APPROVAL", "APPROVED", "SENDING", "PAUSED"], { status: "CANCELLED", cancelledAt: new Date() }, "This campaign has already finished.");
    // A message already handed to SMTP (CLAIMED) is left to finish and be recorded honestly
    const cancelled = await tx.send.updateMany({ where: { campaignId: id, status: "PENDING" }, data: { status: "CANCELLED" } });
    await audit(req, { action: "campaign.cancel", entityType: "Campaign", entityId: id, metadata: { unsent: cancelled.count } }, tx);
  });
}

export async function retryFailed(req: Request, id: string) {
  const campaign = await getCampaignOr404(id);
  if (!["SENDING", "PAUSED", "COMPLETED"].includes(campaign.status)) {
    throw AppError.conflict("INVALID_STATUS", "Failed messages can be retried once a campaign has started.");
  }
  if (campaign.status === "COMPLETED") {
    const blocker = liveSendingBlocker();
    if (blocker) throw AppError.conflict("LIVE_SENDING_LOCKED", blocker);
  }
  return prisma.$transaction(async (tx) => {
    const requeued = await tx.send.updateMany({ where: { campaignId: id, status: "FAILED" }, data: { status: "PENDING", lastError: null } });
    if (requeued.count === 0) throw AppError.badRequest("NOTHING_TO_RETRY", "There are no failed messages to retry.");
    if (campaign.status === "COMPLETED") {
      await transition(tx, id, ["COMPLETED"], { status: "SENDING", completedAt: null }, "The campaign changed; refresh and try again.");
    }
    await audit(req, { action: "campaign.retry_failed", entityType: "Campaign", entityId: id, metadata: { count: requeued.count } }, tx);
    return requeued.count;
  });
}

/** A person decides what happened to a message whose handoff was interrupted */
export async function resolveUnknown(req: Request, campaignId: string, sendId: string, outcome: "sent" | "retry") {
  await prisma.$transaction(async (tx) => {
    const send = await tx.send.findFirst({ where: { id: sendId, campaignId } });
    if (!send) throw AppError.notFound("SEND_NOT_FOUND", "That message no longer exists.");
    const updated = await tx.send.updateMany({
      where: { id: sendId, status: "UNKNOWN" },
      data: outcome === "sent" ? { status: "SENT", sentAt: send.claimedAt ?? new Date() } : { status: "PENDING" },
    });
    if (updated.count !== 1) throw AppError.conflict("INVALID_STATUS", "This message has already been resolved.");
    if (outcome === "retry") {
      await tx.campaign.updateMany({ where: { id: campaignId, status: "COMPLETED" }, data: { status: "SENDING", completedAt: null } });
    }
    await audit(req, { action: outcome === "sent" ? "send.mark_sent" : "send.retry_unknown", entityType: "Send", entityId: sendId, metadata: { email: send.email, campaignId } }, tx);
  });
}

// ---------------------------------------------------------------------------
// ---------------------------------------------------------------------------
// Test send (strictly safe: internal allowlist only, suppression check, dry run support)
// ---------------------------------------------------------------------------

export const PERMITTED_TEST_RECIPIENTS = [
  "s265.frank@gmail.com",
  "aves7203@gmail.com",
] as const;

export function getPermittedTestRecipients(): string[] {
  if (process.env.ALLOWED_TEST_RECIPIENTS) {
    return process.env.ALLOWED_TEST_RECIPIENTS.split(",")
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);
  }
  if (process.env.NODE_ENV === "test") {
    return [...PERMITTED_TEST_RECIPIENTS, "qa@focusrealm.test"];
  }
  return [...PERMITTED_TEST_RECIPIENTS];
}

export function isPermittedTestRecipient(email: string): boolean {
  const allowed = getPermittedTestRecipients();
  if (allowed.includes("*")) return true;
  return allowed.includes(email.toLowerCase().trim());
}

export async function sendTest(
  req: Request,
  id: string,
  to: string[],
  contactId?: string,
  options?: { dryRun?: boolean }
) {
  if (!smtpConfigured) throw AppError.conflict("MAILBOX_NOT_CONFIGURED", "The sending mailbox isn't configured on the server.");

  const normalizedTo = [...new Set(to.map((e) => e.trim().toLowerCase()))];
  const disallowed = normalizedTo.filter((e) => !isPermittedTestRecipient(e));
  if (disallowed.length > 0) {
    throw AppError.badRequest(
      "TEST_RECIPIENT_NOT_ALLOWED",
      `Test sending is restricted to permitted test recipients only (${PERMITTED_TEST_RECIPIENTS.join(", ")}). Disallowed: ${disallowed.join(", ")}`
    );
  }

  // Check suppression list for test recipients
  const activeSuppressions = await prisma.suppressionEntry.findMany({
    where: {
      email: { in: normalizedTo },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
    select: { email: true, reason: true },
  });
  const suppressedMap = new Map(activeSuppressions.map((s) => [s.email.toLowerCase(), s.reason]));

  const campaign = await getCampaignOr404(id);

  const membership = await prisma.listMembership.findFirst({
    where: { contactListId: campaign.contactListId, ...(contactId ? { contactId } : {}) },
    include: { contact: true },
    orderBy: { addedAt: "asc" },
  });
  if (contactId && !membership) throw AppError.badRequest("NOT_A_RECIPIENT", "That contact isn't on this campaign's list.");

  // Multi-template resolution for test send
  const eligibleTemplates = campaign.campaignTemplates.length
    ? campaign.campaignTemplates.map((ct) => ({
        id: ct.template.id,
        name: ct.template.name,
        subject: ct.template.subject,
        bodyHtml: ct.template.bodyHtml,
        bodyText: ct.template.bodyText,
        version: ct.template.version,
        isFallback: ct.isFallback,
        priority: ct.priority,
      }))
    : [
        {
          id: campaign.template.id,
          name: campaign.template.name,
          subject: campaign.subject || campaign.template.subject,
          bodyHtml: campaign.bodyHtml || campaign.template.bodyHtml,
          bodyText: campaign.bodyText || campaign.template.bodyText,
          version: campaign.template.version,
          isFallback: true,
          priority: 0,
        },
      ];

  let selectedTemplate: {
    id: string;
    name: string;
    subject: string;
    bodyHtml: string;
    bodyText?: string | null;
    version: number;
  } = eligibleTemplates[0]!;
  let assignmentExplanation = "Default template";
  let assignmentSource: "RULE" | "OVERRIDE" | "FALLBACK" = "FALLBACK";

  if (membership?.contact) {
    const selection = selectTemplateForRecipient(
      {
        id: membership.contact.id,
        email: membership.contact.email,
        firstName: membership.contact.firstName,
        lastName: membership.contact.lastName,
        company: membership.contact.company,
        title: membership.contact.title,
        hotelSegment: membership.contact.hotelSegment,
        hotelSegmentConfidence: membership.contact.hotelSegmentConfidence,
        hotelSegmentStatus: membership.contact.hotelSegmentStatus,
        contactPersona: membership.contact.contactPersona,
        contactPersonaConfidence: membership.contact.contactPersonaConfidence,
        contactPersonaStatus: membership.contact.contactPersonaStatus,
        customFields:
          typeof membership.contact.customFields === "object" && membership.contact.customFields !== null
            ? (membership.contact.customFields as Record<string, string>)
            : {},
      },
      {
        templates: eligibleTemplates,
        rules: campaign.rules.map((r) => ({
          id: r.id,
          templateId: r.templateId,
          priority: r.priority,
          hotelSegment: r.hotelSegment,
          contactPersona: r.contactPersona,
          requiresVerified: r.requiresVerified,
          minConfidence: r.minConfidence,
          city: r.city,
          description: r.description,
        })),
        overrides: new Map(
          campaign.recipientOverrides.map((o) => [
            o.contactId,
            { contactId: o.contactId, templateId: o.templateId, reason: o.reason },
          ])
        ),
        defaultTemplateId: campaign.templateId,
      }
    );
    selectedTemplate = selection.template;
    assignmentExplanation = selection.explanation;
    assignmentSource = selection.assignmentSource;
  }

  const parts: TemplateParts = {
    subject: selectedTemplate.subject,
    bodyHtml: selectedTemplate.bodyHtml,
    bodyText: selectedTemplate.bodyText,
  };

  const errors = validateTemplate(parts);
  if (errors.length) throw AppError.badRequest("TEMPLATE_INVALID", `Fix the template first: ${errors[0]}`);

  const data = membership
    ? contactMergeData(membership.contact)
    : {
        firstName: "Alex",
        lastName: "Sample",
        fullName: "Alex Sample",
        company: "Sample Hotel Group",
        email: normalizedTo[0] ?? "test@example.com",
        hotelSegment: "Luxury Hotel",
        contactPersona: "General Manager",
      };

  const rendered = renderEmail(parts, data);
  const content = withFooter(rendered.html, rendered.text, unsubscribeUrl("test-preview"), campaign.fromName);

  const results: { to: string; ok: boolean; error?: string; suppressed?: boolean }[] = [];

  // Dry run mode returns rendered preview and recipients without dispatching SMTP
  if (options?.dryRun) {
    for (const address of normalizedTo) {
      if (suppressedMap.has(address)) {
        results.push({ to: address, ok: false, suppressed: true, error: `Suppressed: ${suppressedMap.get(address)}` });
      } else {
        results.push({ to: address, ok: true });
      }
    }
    return {
      dryRun: true,
      recipientCount: normalizedTo.length,
      allowedRecipients: normalizedTo,
      results,
      renderedFor: membership?.contact.email ?? "sample recipient",
      template: {
        id: selectedTemplate.id,
        name: selectedTemplate.name,
        version: selectedTemplate.version,
        assignmentSource,
        assignmentExplanation,
      },
      rendered: {
        subject: `[Test] ${rendered.subject}`,
        html: content.html,
        text: content.text,
      },
      missingFields: rendered.missingFields,
    };
  }

  // Live test send
  const transport = getTransport();
  for (const address of normalizedTo) {
    if (suppressedMap.has(address)) {
      results.push({ to: address, ok: false, suppressed: true, error: `Recipient is suppressed (${suppressedMap.get(address)})` });
      continue;
    }
    try {
      await transport.send({
        to: address,
        subject: `[Test] ${rendered.subject}`,
        html: content.html,
        text: content.text,
        fromName: campaign.fromName,
        fromEmail: campaign.fromEmail,
        replyTo: campaign.replyTo,
        headers: { "X-FR-Test": "true", ...unsubscribeHeaders(unsubscribeUrl("test-preview")) },
      });
      results.push({ to: address, ok: true });
    } catch (err) {
      results.push({ to: address, ok: false, error: (err as Error).message.slice(0, 300) });
    }
  }

  await audit(req, {
    action: "campaign.test_send",
    entityType: "Campaign",
    entityId: id,
    metadata: {
      to: normalizedTo,
      renderedFor: membership?.contact.email ?? "sample data",
      template: selectedTemplate.name,
      failed: results.filter((r) => !r.ok).length,
    },
  });

  return {
    dryRun: false,
    recipientCount: normalizedTo.length,
    results,
    renderedFor: membership?.contact.email ?? null,
    template: {
      id: selectedTemplate.id,
      name: selectedTemplate.name,
      version: selectedTemplate.version,
      assignmentSource,
      assignmentExplanation,
    },
    rendered: {
      subject: `[Test] ${rendered.subject}`,
      html: content.html,
      text: content.text,
    },
    missingFields: rendered.missingFields,
  };
}
