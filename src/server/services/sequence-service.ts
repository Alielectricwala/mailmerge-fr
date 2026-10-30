// Follow-up sequence orchestrator and state engine.
// Handles multi-step scheduling, recipient state tracking, human approvals,
// reply stopping, and persistent safeguards.
import crypto from "crypto";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { AppError } from "../middleware/error-handler.js";
import { messageIdDomain } from "./mailer.js";
import { withFooter, unsubscribeUrl } from "./unsubscribe.js";
import { contactMergeData, renderEmail } from "../../shared/merge.js";
import type {
  CampaignAutomationMode,
  CampaignRecipientStateDto,
  RecipientSequenceState,
  SequenceStepDto,
} from "../../shared/types.js";

type Tx = Prisma.TransactionClient;

/**
 * Calculates a future date by advancing N business days (skipping Sat & Sun).
 * Default cadence in FocusRealm: Day 0 -> +3 business days for first follow-up.
 */
export function addBusinessDays(startDate: Date, businessDays: number): Date {
  const result = new Date(startDate.getTime());
  let daysRemaining = businessDays;
  while (daysRemaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) {
      daysRemaining--;
    }
  }
  return result;
}

export function calculateNextActionTime(startDate: Date, delayDays: number, businessDaysOnly = true): Date {
  if (delayDays <= 0) return new Date(startDate.getTime());
  if (businessDaysOnly) {
    return addBusinessDays(startDate, delayDays);
  }
  const result = new Date(startDate.getTime());
  result.setDate(result.getDate() + delayDays);
  return result;
}

function cleanThreadSubject(subject: string): string {
  const trimmed = subject.trim();
  if (/^re:\s*/i.test(trimmed)) return trimmed;
  return `Re: ${trimmed}`;
}

/**
 * Initializes recipient states when a campaign is approved.
 */
export async function initializeRecipientStates(
  campaignId: string,
  recipients: { contactId: string | null; email: string }[],
  db: Tx | typeof prisma = prisma
): Promise<void> {
  if (!recipients.length) return;
  const now = new Date();
  const rows: Prisma.CampaignRecipientStateCreateManyInput[] = recipients.map((r) => ({
    campaignId,
    contactId: r.contactId,
    email: r.email,
    state: "PENDING_INITIAL",
    currentStepIndex: 0,
    nextActionAt: now,
    nextStepIndex: 0,
  }));

  for (let i = 0; i < rows.length; i += 1000) {
    await db.campaignRecipientState.createMany({
      data: rows.slice(i, i + 1000),
      skipDuplicates: true,
    });
  }
}

/**
 * Called when an email has been successfully sent by the worker.
 * Schedules the next sequence step according to the campaign's automation mode.
 */
export async function onStepSent(
  sendId: string,
  db: Tx | typeof prisma = prisma
): Promise<void> {
  const send = await db.send.findUnique({
    where: { id: sendId },
    include: {
      campaign: {
        include: {
          sequenceSteps: {
            include: { template: true },
            orderBy: { stepIndex: "asc" },
          },
        },
      },
      contact: true,
    },
  });

  if (!send || !send.sentAt) return;
  const campaign = send.campaign;
  const nextStepIndex = send.stepIndex + 1;
  const nextStep = campaign.sequenceSteps.find((s) => s.stepIndex === nextStepIndex);

  // 1. Update recipient state after this send
  const currentState = await db.campaignRecipientState.findUnique({
    where: { campaignId_email: { campaignId: send.campaignId, email: send.email } },
  });

  // If already replied, bounced, or cancelled, do not advance
  if (
    currentState?.state === "REPLY_RECEIVED" ||
    currentState?.state === "BOUNCED" ||
    currentState?.state === "SUPPRESSED" ||
    currentState?.state === "CANCELLED"
  ) {
    return;
  }

  // 2. If no subsequent step, sequence is completed
  if (!nextStep) {
    await db.campaignRecipientState.upsert({
      where: { campaignId_email: { campaignId: send.campaignId, email: send.email } },
      update: {
        state: "COMPLETED",
        currentStepIndex: send.stepIndex,
        lastSentAt: send.sentAt,
        lastMessageId: send.messageId,
        nextActionAt: null,
        nextStepIndex: null,
      },
      create: {
        campaignId: send.campaignId,
        contactId: send.contactId,
        email: send.email,
        state: "COMPLETED",
        currentStepIndex: send.stepIndex,
        lastSentAt: send.sentAt,
        lastMessageId: send.messageId,
      },
    });
    return;
  }

  // 3. Re-verify eligibility before scheduling next step
  const suppression = await db.suppressionEntry.findUnique({ where: { email: send.email } });
  if (suppression && (!suppression.expiresAt || suppression.expiresAt > new Date())) {
    await db.campaignRecipientState.updateMany({
      where: { campaignId: send.campaignId, email: send.email },
      data: { state: "SUPPRESSED", cancelledReason: "Suppression detected before next step", nextActionAt: null },
    });
    return;
  }

  // 4. Calculate next action time
  const scheduledFor = calculateNextActionTime(send.sentAt, nextStep.delayDays, nextStep.delayBusinessDaysOnly);

  // 5. Render email for the next step
  const mergeData = send.contact ? contactMergeData(send.contact) : { email: send.email };
  const baseSubject =
    nextStep.subjectMode === "THREADED"
      ? cleanThreadSubject(send.subject)
      : (nextStep.customSubject || nextStep.template.subject);

  const rendered = renderEmail(
    {
      subject: baseSubject,
      bodyHtml: nextStep.template.bodyHtml,
      bodyText: nextStep.template.bodyText,
    },
    mergeData
  );

  const domain = messageIdDomain();
  const nextSendId = crypto.randomUUID();
  const content = withFooter(rendered.html, rendered.text, unsubscribeUrl(nextSendId), campaign.fromName);

  const mode: CampaignAutomationMode = campaign.automationMode;
  const isAutomatic = mode === "AUTOMATIC";
  const isApprovalRequired = mode === "APPROVAL_REQUIRED";

  const approvedAt = isAutomatic ? new Date() : null;
  const stateVal: RecipientSequenceState = isApprovalRequired
    ? "AWAITING_APPROVAL"
    : isAutomatic
    ? "FOLLOW_UP_SCHEDULED"
    : "PAUSED";

  // Create next Send record if one does not already exist
  await db.send.upsert({
    where: {
      campaignId_email_stepIndex: {
        campaignId: send.campaignId,
        email: send.email,
        stepIndex: nextStepIndex,
      },
    },
    update: {},
    create: {
      id: nextSendId,
      campaignId: send.campaignId,
      contactId: send.contactId,
      email: send.email,
      subject: rendered.subject,
      html: content.html,
      text: content.text,
      messageId: `<${nextSendId}@${domain}>`,
      status: "PENDING",
      stepIndex: nextStepIndex,
      scheduledFor,
      approvedAt,
      inReplyToId: send.messageId,
      templateId: nextStep.templateId,
      assignmentReason: `Sequence Step ${nextStepIndex}: ${nextStep.purpose}`,
    },
  });

  // Update recipient state
  await db.campaignRecipientState.upsert({
    where: { campaignId_email: { campaignId: send.campaignId, email: send.email } },
    update: {
      state: stateVal,
      currentStepIndex: send.stepIndex,
      nextStepIndex,
      nextActionAt: scheduledFor,
      lastSentAt: send.sentAt,
      lastMessageId: send.messageId,
      pausedReason: mode === "MANUAL" ? "Manual mode — waiting for manual send" : null,
    },
    create: {
      campaignId: send.campaignId,
      contactId: send.contactId,
      email: send.email,
      state: stateVal,
      currentStepIndex: send.stepIndex,
      nextStepIndex,
      nextActionAt: scheduledFor,
      lastSentAt: send.sentAt,
      lastMessageId: send.messageId,
    },
  });
}

/**
 * Halts all future outreach for a recipient immediately when a reply, bounce,
 * or unsubscribe occurs.
 */
export async function stopSequenceForRecipient(
  campaignId: string,
  email: string,
  reason: string,
  targetState: RecipientSequenceState = "CANCELLED",
  db: Tx | typeof prisma = prisma
): Promise<number> {
  const { count } = await db.send.updateMany({
    where: {
      campaignId,
      email,
      status: { in: ["PENDING", "CLAIMED"] },
      stepIndex: { gt: 0 },
    },
    data: {
      status: "CANCELLED",
      skipReason: reason,
    },
  });

  await db.campaignRecipientState.upsert({
    where: { campaignId_email: { campaignId, email } },
    update: {
      state: targetState,
      cancelledReason: reason,
      nextActionAt: null,
      nextStepIndex: null,
      ...(targetState === "REPLY_RECEIVED" ? { repliedAt: new Date() } : {}),
      ...(targetState === "BOUNCED" ? { bouncedAt: new Date() } : {}),
      ...(targetState === "SUPPRESSED" ? { unsubscribedAt: new Date() } : {}),
    },
    create: {
      campaignId,
      email,
      state: targetState,
      cancelledReason: reason,
      nextActionAt: null,
      nextStepIndex: null,
      ...(targetState === "REPLY_RECEIVED" ? { repliedAt: new Date() } : {}),
    },
  });

  return count;
}

/**
 * Approves a single follow-up send.
 */
export async function approveFollowUpSend(
  campaignId: string,
  sendId: string
): Promise<void> {
  const send = await prisma.send.findUnique({
    where: { id: sendId },
    include: { campaign: true },
  });

  if (!send || send.campaignId !== campaignId) {
    throw AppError.notFound("SEND_NOT_FOUND", "Follow-up message not found.");
  }
  if (send.status !== "PENDING") {
    throw AppError.conflict("INVALID_STATUS", "This message is not pending.");
  }

  // Safety check: has recipient replied or bounced?
  const recipientState = await prisma.campaignRecipientState.findUnique({
    where: { campaignId_email: { campaignId, email: send.email } },
  });
  if (recipientState?.state === "REPLY_RECEIVED") {
    throw AppError.conflict("REPLY_DETECTED", "Cannot approve: recipient already replied.");
  }
  if (recipientState?.state === "BOUNCED" || recipientState?.state === "SUPPRESSED") {
    throw AppError.conflict("INELIGIBLE", "Cannot approve: recipient is bounced or suppressed.");
  }

  await prisma.$transaction(async (tx) => {
    await tx.send.update({
      where: { id: sendId },
      data: { approvedAt: new Date() },
    });
    await tx.campaignRecipientState.updateMany({
      where: { campaignId, email: send.email },
      data: { state: "FOLLOW_UP_SCHEDULED" },
    });
  });
}

/**
 * Bulk approves all follow-ups currently awaiting approval in this campaign.
 */
export async function approveAllPendingFollowUps(
  campaignId: string
): Promise<number> {
  // Find all sends awaiting approval where recipient has NOT replied/bounced/suppressed
  const pendingSends = await prisma.send.findMany({
    where: {
      campaignId,
      status: "PENDING",
      approvedAt: null,
      stepIndex: { gt: 0 },
    },
    select: { id: true, email: true },
  });

  if (!pendingSends.length) return 0;

  // Filter out any that received replies or are suppressed
  const emails = pendingSends.map((s) => s.email);
  const badStates = await prisma.campaignRecipientState.findMany({
    where: {
      campaignId,
      email: { in: emails },
      state: { in: ["REPLY_RECEIVED", "BOUNCED", "SUPPRESSED", "CANCELLED"] },
    },
    select: { email: true },
  });
  const badEmails = new Set(badStates.map((b) => b.email));
  const eligibleIds = pendingSends.filter((s) => !badEmails.has(s.email)).map((s) => s.id);
  const eligibleEmails = pendingSends.filter((s) => !badEmails.has(s.email)).map((s) => s.email);

  if (!eligibleIds.length) return 0;

  await prisma.$transaction(async (tx) => {
    await tx.send.updateMany({
      where: { id: { in: eligibleIds } },
      data: { approvedAt: new Date() },
    });
    await tx.campaignRecipientState.updateMany({
      where: { campaignId, email: { in: eligibleEmails }, state: "AWAITING_APPROVAL" },
      data: { state: "FOLLOW_UP_SCHEDULED" },
    });
  });

  return eligibleIds.length;
}

/**
 * Pauses a particular recipient's sequence.
 */
export async function pauseRecipientSequence(
  campaignId: string,
  email: string,
  reason = "Paused by user",
  db: Tx | typeof prisma = prisma
): Promise<void> {
  await db.campaignRecipientState.updateMany({
    where: { campaignId, email },
    data: { state: "PAUSED", pausedReason: reason },
  });
}

/**
 * Resumes a paused recipient's sequence after revalidating safety checks.
 */
export async function resumeRecipientSequence(
  campaignId: string,
  email: string,
  db: Tx | typeof prisma = prisma
): Promise<void> {
  const current = await db.campaignRecipientState.findUnique({
    where: { campaignId_email: { campaignId, email } },
  });
  if (!current) throw AppError.notFound("NOT_FOUND", "Recipient not in campaign.");

  if (current.state === "REPLY_RECEIVED") {
    throw AppError.conflict("REPLY_RECEIVED", "Cannot resume: recipient sent a reply. Outreach is halted.");
  }
  if (current.state === "BOUNCED" || current.state === "SUPPRESSED") {
    throw AppError.conflict("INELIGIBLE", "Cannot resume: recipient is suppressed or bounced.");
  }

  // Determine state: check if pending send exists
  const nextSend = await db.send.findFirst({
    where: { campaignId, email, status: "PENDING" },
    orderBy: { stepIndex: "asc" },
  });

  const newState: RecipientSequenceState = nextSend
    ? nextSend.approvedAt
      ? "FOLLOW_UP_SCHEDULED"
      : "AWAITING_APPROVAL"
    : "COMPLETED";

  await db.campaignRecipientState.update({
    where: { campaignId_email: { campaignId, email } },
    data: { state: newState, pausedReason: null },
  });
}

/**
 * Stops all pending follow-ups for a whole campaign.
 */
export async function stopAllPendingFollowUps(
  campaignId: string,
  reason = "All follow-ups stopped by user",
  db: Tx | typeof prisma = prisma
): Promise<number> {
  const { count } = await db.send.updateMany({
    where: {
      campaignId,
      status: { in: ["PENDING", "CLAIMED"] },
      stepIndex: { gt: 0 },
    },
    data: {
      status: "CANCELLED",
      skipReason: reason,
    },
  });

  await db.campaignRecipientState.updateMany({
    where: {
      campaignId,
      state: { in: ["FOLLOW_UP_SCHEDULED", "AWAITING_APPROVAL", "PAUSED"] },
    },
    data: {
      state: "CANCELLED",
      cancelledReason: reason,
      nextActionAt: null,
      nextStepIndex: null,
    },
  });

  return count;
}

/**
 * Returns full history and sequence state for a recipient in a campaign.
 */
export async function getRecipientSequenceDetails(
  campaignId: string,
  email: string
): Promise<CampaignRecipientStateDto | null> {
  const [state, sends] = await Promise.all([
    prisma.campaignRecipientState.findUnique({
      where: { campaignId_email: { campaignId, email } },
    }),
    prisma.send.findMany({
      where: { campaignId, email },
      orderBy: { stepIndex: "asc" },
      select: {
        id: true,
        stepIndex: true,
        subject: true,
        sentAt: true,
        status: true,
        messageId: true,
      },
    }),
  ]);

  if (!state && !sends.length) return null;

  return {
    id: state?.id ?? `virtual-${campaignId}-${email}`,
    campaignId,
    contactId: state?.contactId ?? null,
    email,
    state: state?.state ?? "PENDING_INITIAL",
    currentStepIndex: state?.currentStepIndex ?? 0,
    nextActionAt: state?.nextActionAt?.toISOString() ?? null,
    nextStepIndex: state?.nextStepIndex ?? null,
    pausedReason: state?.pausedReason ?? null,
    cancelledReason: state?.cancelledReason ?? null,
    lastSentAt: state?.lastSentAt?.toISOString() ?? null,
    lastMessageId: state?.lastMessageId ?? null,
    repliedAt: state?.repliedAt?.toISOString() ?? null,
    bouncedAt: state?.bouncedAt?.toISOString() ?? null,
    unsubscribedAt: state?.unsubscribedAt?.toISOString() ?? null,
    history: sends.map((s) => ({
      sendId: s.id,
      stepIndex: s.stepIndex,
      subject: s.subject,
      sentAt: s.sentAt ? s.sentAt.toISOString() : null,
      status: s.status,
      messageId: s.messageId,
    })),
  };
}

/**
 * AI assistance for follow-up drafting and personalization.
 * Strictly avoids inventing facts, preserves concise business tone,
 * and falls back reliably to high-converting cadences.
 */
export async function aiDraftFollowUp(params: {
  stepIndex: number;
  purpose?: string;
  previousSubject?: string;
  previousBody?: string;
  instructions?: string;
}): Promise<{ subject: string; bodyHtml: string; bodyText: string; rationale: string }> {
  const step = params.stepIndex || 1;
  const prevSub = params.previousSubject || "Partnership with FocusRealm";
  const threadedSubject = cleanThreadSubject(prevSub);

  if (process.env.GEMINI_API_KEY) {
    try {
      const prompt = `You are an executive outreach specialist for FocusRealm.
FocusRealm helps hotel partners (luxury, boutique, and upscale resorts) improve guest direct engagement and operational performance.
Draft a follow-up email for Step ${step} of an email sequence.
Purpose: ${params.purpose || (step === 1 ? "Add value & social proof" : step === 2 ? "Partnership proposal & mutual benefit" : "Permission-based breakup / final check-in")}.
Previous Subject: ${prevSub}
Previous Email Context: ${params.previousBody ? params.previousBody.slice(0, 500) : "Initial outreach introducing FocusRealm"}
User Guidance: ${params.instructions || "Keep it concise, conversational, and direct. Avoid generic marketing buzzwords. Do not invent fake facts."}

Rules:
1. Threaded subject should start with 'Re: ' unless specified otherwise.
2. The message must sound like a real businessperson following up respectfully.
3. Keep it under 100 words.
4. Use standard merge fields like {{firstName|there}} and {{company|your property}}.

Return STRICT JSON with keys:
- "subject": string
- "bodyText": string
- "rationale": string`;

      const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { responseMimeType: "application/json" },
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as any;
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
        if (text) {
          const parsed = JSON.parse(text);
          if (parsed.subject && parsed.bodyText) {
            const html = parsed.bodyText
              .split("\n\n")
              .map((p: string) => `<p>${p.replace(/\n/g, "<br>")}</p>`)
              .join("");
            return {
              subject: parsed.subject,
              bodyHtml: html,
              bodyText: parsed.bodyText,
              rationale: parsed.rationale || "AI-generated tailored follow-up based on context.",
            };
          }
        }
      }
    } catch {
      // Fall through to deterministic high-converting templates
    }
  }

  // Deterministic high-converting templates based on proven sequence architecture:
  if (step === 1) {
    const text = `Hi {{firstName|there}},\n\nFollowing up briefly on my earlier note. I know you receive many inquiries, but I wanted to share a quick proof point regarding how FocusRealm collaborates with properties like {{company|yours}} to enhance guest loyalty without disrupting your existing workflows.\n\nWould you have 10 minutes this week for a brief introductory call?\n\nBest regards,\nFounder's Office, FocusRealm`;
    return {
      subject: threadedSubject,
      bodyText: text,
      bodyHtml: `<p>Hi {{firstName|there}},</p><p>Following up briefly on my earlier note. I know you receive many inquiries, but I wanted to share a quick proof point regarding how FocusRealm collaborates with properties like {{company|yours}} to enhance guest loyalty without disrupting your existing workflows.</p><p>Would you have 10 minutes this week for a brief introductory call?</p><p>Best regards,<br>Founder's Office, FocusRealm</p>`,
      rationale: "Step 1: Focuses on quick relevance, proof point, and low-friction 10-minute call request.",
    };
  }

  if (step === 2) {
    const text = `Hi {{firstName|there}},\n\nI wanted to share one more angle that might be relevant for {{company|your hotel}}—specifically how our co-marketing and guest engagement features generate direct repeat bookings.\n\nIf you're interested, I can send over a 2-page brief summarizing the impact for similar hotels.\n\nWould that be helpful?\n\nWarm regards,\nFounder's Office, FocusRealm`;
    return {
      subject: threadedSubject,
      bodyText: text,
      bodyHtml: `<p>Hi {{firstName|there}},</p><p>I wanted to share one more angle that might be relevant for {{company|your hotel}}—specifically how our co-marketing and guest engagement features generate direct repeat bookings.</p><p>If you're interested, I can send over a 2-page brief summarizing the impact for similar hotels.</p><p>Would that be helpful?</p><p>Warm regards,<br>Founder's Office, FocusRealm</p>`,
      rationale: "Step 2: Offers a zero-commitment asset (2-page brief) to re-engage interest.",
    };
  }

  // Step 3+: Permission-based close / breakup
  const breakupText = `Hi {{firstName|there}},\n\nI assume this isn't the right time to connect about FocusRealm and {{company|your property}}, so I won't follow up again.\n\nIf priorities open up in the future and you'd ever like to explore a partnership, please feel free to reach back out anytime.\n\nWishing you and your team all the best,\nFounder's Office, FocusRealm`;
  return {
    subject: threadedSubject,
    bodyText: breakupText,
    bodyHtml: `<p>Hi {{firstName|there}},</p><p>I assume this isn't the right time to connect about FocusRealm and {{company|your property}}, so I won't follow up again.</p><p>If priorities open up in the future and you'd ever like to explore a partnership, please feel free to reach back out anytime.</p><p>Wishing you and your team all the best,<br>Founder's Office, FocusRealm</p>`,
    rationale: "Step 3: Permission-based breakup email. Respects their inbox and achieves the highest reply rate for closing conversations.",
  };
}
