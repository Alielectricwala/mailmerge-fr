import prisma from "../db.js";
import type { Prisma } from "@prisma/client";
import { AppError } from "../middleware/error-handler.js";
import type {
  CampaignAnalyticsSummaryDto,
  TemplatePerformanceItemDto,
  ActionableInsightDto,
  WorkspaceTemplateAnalyticsDto,
  TemplateAnalyticsQuery,
} from "../../shared/types.js";

export async function getCampaignAnalytics(campaignId: string): Promise<CampaignAnalyticsSummaryDto> {
  const campaign = await prisma.campaign.findUnique({
    where: { id: campaignId },
    include: {
      template: { select: { id: true, name: true, version: true } },
      campaignTemplates: {
        include: { template: { select: { id: true, name: true, version: true } } },
      },
      sequenceSteps: { orderBy: { stepIndex: "asc" } },
    },
  });

  if (!campaign) {
    throw AppError.notFound("CAMPAIGN_NOT_FOUND", "Campaign not found.");
  }

  // Fetch all sends for this campaign with contact classification and events
  const sends = await prisma.send.findMany({
    where: { campaignId },
    include: {
      contact: {
        select: {
          id: true,
          hotelSegment: true,
          contactPersona: true,
        },
      },
      events: {
        select: {
          id: true,
          type: true,
          occurredAt: true,
          detail: true,
        },
      },
    },
  });

  const totalRecipients = sends.length;
  let attemptedSends = 0;
  let providerAcceptedCount = 0;
  let bouncedCount = 0;
  let repliedCount = 0;
  let positiveRepliesCount = 0;
  let meetingsBookedCount = 0;
  let unsubscribedCount = 0;

  // Breakdown aggregators
  const stepMap = new Map<
    number,
    {
      stepIndex: number;
      purpose: string;
      assignedCount: number;
      sentCount: number;
      repliedCount: number;
      positiveRepliesCount: number;
      meetingsBookedCount: number;
      bouncedCount: number;
      replyRate: number;
    }
  >();

  for (const st of campaign.sequenceSteps) {
    stepMap.set(st.stepIndex, {
      stepIndex: st.stepIndex,
      purpose: st.purpose,
      assignedCount: 0,
      sentCount: 0,
      repliedCount: 0,
      positiveRepliesCount: 0,
      meetingsBookedCount: 0,
      bouncedCount: 0,
      replyRate: 0,
    });
  }
  const templateMap = new Map<
    string,
    {
      templateId: string;
      templateName: string;
      templateVersion: number;
      assignedCount: number;
      sentCount: number;
      repliedCount: number;
      positiveRepliesCount: number;
      meetingsBookedCount: number;
    }
  >();

  // Initialize known campaign templates
  if (campaign.campaignTemplates.length > 0) {
    for (const ct of campaign.campaignTemplates) {
      templateMap.set(ct.templateId, {
        templateId: ct.templateId,
        templateName: ct.template.name,
        templateVersion: ct.template.version,
        assignedCount: 0,
        sentCount: 0,
        repliedCount: 0,
        positiveRepliesCount: 0,
        meetingsBookedCount: 0,
      });
    }
  } else {
    templateMap.set(campaign.template.id, {
      templateId: campaign.template.id,
      templateName: campaign.template.name,
      templateVersion: campaign.template.version,
      assignedCount: 0,
      sentCount: 0,
      repliedCount: 0,
      positiveRepliesCount: 0,
      meetingsBookedCount: 0,
    });
  }

  const segmentMap = new Map<
    string,
    {
      segment: string;
      assignedCount: number;
      sentCount: number;
      repliedCount: number;
      positiveRepliesCount: number;
      meetingsBookedCount: number;
    }
  >();

  const personaMap = new Map<
    string,
    {
      persona: string;
      assignedCount: number;
      sentCount: number;
      repliedCount: number;
      positiveRepliesCount: number;
      meetingsBookedCount: number;
    }
  >();

  for (const send of sends) {
    attemptedSends += Math.max(1, send.attempts);
    const isSent = send.status === "SENT";
    const isBounced = Boolean(send.bouncedAt || (send.status === "FAILED" && send.attempts > 0));
    const isReplied = Boolean(send.repliedAt);
    const isUnsubscribed = Boolean(send.unsubscribedAt);

    if (isSent) providerAcceptedCount++;
    if (isBounced) bouncedCount++;
    if (isReplied) repliedCount++;
    if (isUnsubscribed) unsubscribedCount++;

    // Check for positive replies or meetings booked from events
    let isPositive = false;
    let isMeeting = false;

    for (const ev of send.events) {
      const d = ev.detail as Record<string, unknown> | null;
      if (d) {
        if (d.classification === "POSITIVE" || d.sentiment === "positive") isPositive = true;
        if (d.meetingBooked === true || d.meetingOutcome === "BOOKED" || d.meetingOutcome === "QUALIFIED") {
          isMeeting = true;
        }
      }
    }

    if (isPositive) positiveRepliesCount++;
    if (isMeeting) meetingsBookedCount++;

    // Template attribution
    const tId = send.templateId || campaign.templateId;
    let tEntry = templateMap.get(tId);
    if (!tEntry) {
      tEntry = {
        templateId: tId,
        templateName: "Assigned Template",
        templateVersion: send.templateVersion || 1,
        assignedCount: 0,
        sentCount: 0,
        repliedCount: 0,
        positiveRepliesCount: 0,
        meetingsBookedCount: 0,
      };
      templateMap.set(tId, tEntry);
    }
    tEntry.assignedCount++;
    if (isSent) tEntry.sentCount++;
    if (isReplied) tEntry.repliedCount++;
    if (isPositive) tEntry.positiveRepliesCount++;
    if (isMeeting) tEntry.meetingsBookedCount++;

    // Segment attribution
    const seg = send.contact?.hotelSegment || "UNCLASSIFIED";
    let sEntry = segmentMap.get(seg);
    if (!sEntry) {
      sEntry = {
        segment: seg,
        assignedCount: 0,
        sentCount: 0,
        repliedCount: 0,
        positiveRepliesCount: 0,
        meetingsBookedCount: 0,
      };
      segmentMap.set(seg, sEntry);
    }
    sEntry.assignedCount++;
    if (isSent) sEntry.sentCount++;
    if (isReplied) sEntry.repliedCount++;
    if (isPositive) sEntry.positiveRepliesCount++;
    if (isMeeting) sEntry.meetingsBookedCount++;

    // Persona attribution
    const per = send.contact?.contactPersona || "UNCLASSIFIED";
    let pEntry = personaMap.get(per);
    if (!pEntry) {
      pEntry = {
        persona: per,
        assignedCount: 0,
        sentCount: 0,
        repliedCount: 0,
        positiveRepliesCount: 0,
        meetingsBookedCount: 0,
      };
      personaMap.set(per, pEntry);
    }
    pEntry.assignedCount++;
    if (isSent) pEntry.sentCount++;
    if (isReplied) pEntry.repliedCount++;
    if (isPositive) pEntry.positiveRepliesCount++;
    if (isMeeting) pEntry.meetingsBookedCount++;

    // Step attribution
    const stepIdx = send.stepIndex ?? 0;
    let stepEntry = stepMap.get(stepIdx);
    if (!stepEntry) {
      stepEntry = {
        stepIndex: stepIdx,
        purpose: stepIdx === 0 ? "Initial Email" : `Follow-up ${stepIdx}`,
        assignedCount: 0,
        sentCount: 0,
        repliedCount: 0,
        positiveRepliesCount: 0,
        meetingsBookedCount: 0,
        bouncedCount: 0,
        replyRate: 0,
      };
      stepMap.set(stepIdx, stepEntry);
    }
    stepEntry.assignedCount++;
    if (isSent) stepEntry.sentCount++;
    if (isReplied) stepEntry.repliedCount++;
    if (isPositive) stepEntry.positiveRepliesCount++;
    if (isMeeting) stepEntry.meetingsBookedCount++;
    if (isBounced) stepEntry.bouncedCount++;
  }

  for (const s of stepMap.values()) {
    s.replyRate = s.sentCount > 0 ? Number(((s.repliedCount / s.sentCount) * 100).toFixed(1)) : 0;
  }

  // Denominator: Provider-accepted sends (never count rejected attempts or total list size as delivered)
  const denominator = Math.max(1, providerAcceptedCount);

  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    totalRecipients,
    attemptedSends,
    providerAcceptedCount,
    bouncedCount,
    repliedCount,
    positiveRepliesCount,
    meetingsBookedCount,
    unsubscribedCount,
    rates: {
      bounceRate: Number(((bouncedCount / denominator) * 100).toFixed(1)),
      replyRate: Number(((repliedCount / denominator) * 100).toFixed(1)),
      positiveReplyRate: Number(((positiveRepliesCount / denominator) * 100).toFixed(1)),
      meetingRate: Number(((meetingsBookedCount / denominator) * 100).toFixed(1)),
      unsubscribeRate: Number(((unsubscribedCount / denominator) * 100).toFixed(1)),
    },
    byTemplate: [...templateMap.values()],
    byHotelSegment: [...segmentMap.values()],
    byContactPersona: [...personaMap.values()],
    bySequenceStep: [...stepMap.values()],
  };
}

export async function recordSendOutcome(
  sendId: string,
  outcome: {
    replyClassification?: "POSITIVE" | "NEGATIVE" | "NEUTRAL" | "OUT_OF_OFFICE";
    meetingBooked?: boolean;
    note?: string;
  }
) {
  const send = await prisma.send.findUnique({
    where: { id: sendId },
    include: { events: true },
  });

  if (!send) {
    throw AppError.notFound("SEND_NOT_FOUND", "Send message record not found.");
  }

  // If classifying reply, ensure reply timestamp is marked
  if (outcome.replyClassification && !send.repliedAt) {
    await prisma.send.update({
      where: { id: sendId },
      data: { repliedAt: new Date() },
    });
  }

  // Record an audit/outcome event on the Send
  const event = await prisma.sendEvent.create({
    data: {
      sendId,
      type: "REPLY",
      occurredAt: new Date(),
      detail: {
        classification: outcome.replyClassification ?? null,
        meetingBooked: outcome.meetingBooked ?? false,
        note: outcome.note ?? null,
        recordedManually: true,
      },
    },
  });

  return event;
}

export async function getWorkspaceTemplateAnalytics(
  query: TemplateAnalyticsQuery = {}
): Promise<WorkspaceTemplateAnalyticsDto> {
  const { campaignId, dateRange, hotelSegment, contactPersona, templateId } = query;

  // Build date filter
  let dateFilter: Date | undefined;
  if (dateRange === "7d") dateFilter = new Date(Date.now() - 7 * 86_400_000);
  else if (dateRange === "30d") dateFilter = new Date(Date.now() - 30 * 86_400_000);
  else if (dateRange === "90d") dateFilter = new Date(Date.now() - 90 * 86_400_000);

  // Fetch all templates and campaigns
  const [allTemplates, allCampaigns, sends] = await Promise.all([
    prisma.template.findMany({
      orderBy: { name: "asc" },
      select: { id: true, name: true, subject: true, version: true },
    }),
    prisma.campaign.findMany({
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    prisma.send.findMany({
      where: {
        ...(campaignId ? { campaignId } : {}),
        ...(dateFilter ? { createdAt: { gte: dateFilter } } : {}),
        ...(contactPersona ? { contact: { contactPersona } } : {}),
        ...(hotelSegment ? { contact: { hotelSegment } } : {}),
      },
      include: {
        campaign: { select: { id: true, name: true, templateId: true } },
        contact: { select: { hotelSegment: true, contactPersona: true } },
        events: {
          select: {
            type: true,
            detail: true,
          },
        },
      },
    }),
  ]);

  // Distinct filter options
  const segmentsSet = new Set<string>();
  const personasSet = new Set<string>();

  // Map of template stats
  type TemplateStatCollector = {
    templateId: string;
    templateName: string;
    currentVersion: number;
    subject: string;
    assignedCount: number;
    attemptedCount: number;
    providerAcceptedCount: number;
    failedCount: number;
    bouncedCount: number;
    repliedCount: number;
    positiveRepliesCount: number;
    negativeRepliesCount: number;
    neutralRepliesCount: number;
    outOfOfficeCount: number;
    meetingsBookedCount: number;
    unsubscribedCount: number;
    segmentStats: Map<string, { delivered: number; replied: number; meetings: number }>;
    personaStats: Map<string, { delivered: number; replied: number; meetings: number }>;
  };

  const templateMap = new Map<string, TemplateStatCollector>();

  for (const t of allTemplates) {
    if (templateId && t.id !== templateId) continue;
    templateMap.set(t.id, {
      templateId: t.id,
      templateName: t.name,
      currentVersion: t.version,
      subject: t.subject,
      assignedCount: 0,
      attemptedCount: 0,
      providerAcceptedCount: 0,
      failedCount: 0,
      bouncedCount: 0,
      repliedCount: 0,
      positiveRepliesCount: 0,
      negativeRepliesCount: 0,
      neutralRepliesCount: 0,
      outOfOfficeCount: 0,
      meetingsBookedCount: 0,
      unsubscribedCount: 0,
      segmentStats: new Map(),
      personaStats: new Map(),
    });
  }

  for (const send of sends) {
    const assignedTemplateId = send.templateId || send.campaign.templateId;
    if (templateId && assignedTemplateId !== templateId) continue;

    let stat = templateMap.get(assignedTemplateId);
    if (!stat) {
      stat = {
        templateId: assignedTemplateId,
        templateName: "Assigned Template",
        currentVersion: send.templateVersion || 1,
        subject: send.subject || "(Subject unavailable)",
        assignedCount: 0,
        attemptedCount: 0,
        providerAcceptedCount: 0,
        failedCount: 0,
        bouncedCount: 0,
        repliedCount: 0,
        positiveRepliesCount: 0,
        negativeRepliesCount: 0,
        neutralRepliesCount: 0,
        outOfOfficeCount: 0,
        meetingsBookedCount: 0,
        unsubscribedCount: 0,
        segmentStats: new Map(),
        personaStats: new Map(),
      };
      templateMap.set(assignedTemplateId, stat);
    }

    stat.assignedCount++;
    const isAttempted = send.attempts > 0 || ["SENT", "FAILED", "UNKNOWN"].includes(send.status);
    if (isAttempted) stat.attemptedCount++;

    const isAccepted = send.status === "SENT";
    if (isAccepted) stat.providerAcceptedCount++;

    if (send.status === "FAILED") stat.failedCount++;
    if (send.bouncedAt) stat.bouncedCount++;
    if (send.repliedAt) stat.repliedCount++;
    if (send.unsubscribedAt) stat.unsubscribedCount++;

    const isDelivered = isAccepted && !send.bouncedAt;

    // Classification and outcomes from events
    let isPositive = false;
    let isNegative = false;
    let isNeutral = false;
    let isOoo = false;
    let isMeeting = false;

    for (const ev of send.events) {
      const d = ev.detail as Record<string, unknown> | null;
      if (d) {
        const cls = String(d.classification || d.sentiment || "").toUpperCase();
        if (cls === "POSITIVE") isPositive = true;
        else if (cls === "NEGATIVE") isNegative = true;
        else if (cls === "OUT_OF_OFFICE") isOoo = true;
        else if (cls === "NEUTRAL") isNeutral = true;

        if (d.meetingBooked === true || d.meetingOutcome === "BOOKED" || d.meetingOutcome === "QUALIFIED") {
          isMeeting = true;
        }
      }
    }

    if (isPositive) stat.positiveRepliesCount++;
    if (isNegative) stat.negativeRepliesCount++;
    if (isNeutral) stat.neutralRepliesCount++;
    if (isOoo) stat.outOfOfficeCount++;
    if (isMeeting) stat.meetingsBookedCount++;

    // Audience breakdowns
    const seg = send.contact?.hotelSegment || "UNCLASSIFIED";
    const per = send.contact?.contactPersona || "UNCLASSIFIED";
    if (send.contact?.hotelSegment) segmentsSet.add(send.contact.hotelSegment);
    if (send.contact?.contactPersona) personasSet.add(send.contact.contactPersona);

    const sEntry = stat.segmentStats.get(seg) ?? { delivered: 0, replied: 0, meetings: 0 };
    if (isDelivered) sEntry.delivered++;
    if (send.repliedAt) sEntry.replied++;
    if (isMeeting) sEntry.meetings++;
    stat.segmentStats.set(seg, sEntry);

    const pEntry = stat.personaStats.get(per) ?? { delivered: 0, replied: 0, meetings: 0 };
    if (isDelivered) pEntry.delivered++;
    if (send.repliedAt) pEntry.replied++;
    if (isMeeting) pEntry.meetings++;
    stat.personaStats.set(per, pEntry);
  }

  // Format templates items
  let totalAssigned = 0;
  let totalAttempted = 0;
  let totalProviderAccepted = 0;
  let totalDelivered = 0;
  let totalBounced = 0;
  let totalReplies = 0;
  let totalPositiveReplies = 0;
  let totalMeetingsBooked = 0;

  const templateItems: TemplatePerformanceItemDto[] = [];

  for (const s of templateMap.values()) {
    const deliveredCount = Math.max(0, s.providerAcceptedCount - s.bouncedCount);
    totalAssigned += s.assignedCount;
    totalAttempted += s.attemptedCount;
    totalProviderAccepted += s.providerAcceptedCount;
    totalDelivered += deliveredCount;
    totalBounced += s.bouncedCount;
    totalReplies += s.repliedCount;
    totalPositiveReplies += s.positiveRepliesCount;
    totalMeetingsBooked += s.meetingsBookedCount;

    const deliveryDenom = Math.max(1, s.attemptedCount);
    const deliveredDenom = Math.max(1, deliveredCount);

    const deliveryRate = s.attemptedCount > 0 ? Number(((deliveredCount / deliveryDenom) * 100).toFixed(1)) : 0;
    const replyRate = deliveredCount > 0 ? Number(((s.repliedCount / deliveredDenom) * 100).toFixed(1)) : 0;
    const positiveReplyRate = deliveredCount > 0 ? Number(((s.positiveRepliesCount / deliveredDenom) * 100).toFixed(1)) : 0;
    const meetingRate = deliveredCount > 0 ? Number(((s.meetingsBookedCount / deliveredDenom) * 100).toFixed(1)) : 0;
    const unsubscribeRate = deliveredCount > 0 ? Number(((s.unsubscribedCount / deliveredDenom) * 100).toFixed(1)) : 0;

    const bySegment = [...s.segmentStats.entries()].map(([segment, data]) => ({
      segment,
      deliveredCount: data.delivered,
      repliedCount: data.replied,
      replyRate: data.delivered > 0 ? Number(((data.replied / data.delivered) * 100).toFixed(1)) : 0,
      meetingsCount: data.meetings,
    }));

    const byPersona = [...s.personaStats.entries()].map(([persona, data]) => ({
      persona,
      deliveredCount: data.delivered,
      repliedCount: data.replied,
      replyRate: data.delivered > 0 ? Number(((data.replied / data.delivered) * 100).toFixed(1)) : 0,
      meetingsCount: data.meetings,
    }));

    templateItems.push({
      templateId: s.templateId,
      templateName: s.templateName,
      currentVersion: s.currentVersion,
      subject: s.subject,
      assignedCount: s.assignedCount,
      attemptedCount: s.attemptedCount,
      providerAcceptedCount: s.providerAcceptedCount,
      deliveredCount,
      failedCount: s.failedCount,
      bouncedCount: s.bouncedCount,
      repliedCount: s.repliedCount,
      positiveRepliesCount: s.positiveRepliesCount,
      negativeRepliesCount: s.negativeRepliesCount,
      neutralRepliesCount: s.neutralRepliesCount,
      outOfOfficeCount: s.outOfOfficeCount,
      meetingsBookedCount: s.meetingsBookedCount,
      unsubscribedCount: s.unsubscribedCount,
      deliveryRate,
      replyRate,
      positiveReplyRate,
      meetingRate,
      unsubscribeRate,
      isLimitedData: s.attemptedCount < 20,
      bySegment,
      byPersona,
    });
  }

  // Sort templates: those with activity first, then by reply rate
  templateItems.sort((a, b) => {
    if (a.attemptedCount === 0 && b.attemptedCount > 0) return 1;
    if (b.attemptedCount === 0 && a.attemptedCount > 0) return -1;
    return b.replyRate - a.replyRate;
  });

  // Actionable Insights generator
  const insights: ActionableInsightDto[] = [];

  // 1. Top performing template observation
  const informativeTemplates = templateItems.filter((t) => !t.isLimitedData && t.deliveredCount > 0);
  if (informativeTemplates.length > 0) {
    const top = informativeTemplates[0]!;
    if (top.replyRate > 0) {
      insights.push({
        type: "top_performer",
        category: "OBSERVATION",
        title: `Strongest Observed Reply Rate: "${top.templateName}"`,
        description: `Generated a ${top.replyRate}% reply rate across ${top.deliveredCount} delivered recipients (${top.repliedCount} total replies, ${top.positiveRepliesCount} positive).`,
        metricBadge: `${top.replyRate}% Reply Rate`,
        recommendation: `Consider using "${top.templateName}" as the primary template for similar prospect segments.`,
      });
    }
  }

  // 2. Limited data warning observation
  const smallSampleTemplates = templateItems.filter((t) => t.attemptedCount > 0 && t.isLimitedData);
  if (smallSampleTemplates.length > 0) {
    insights.push({
      type: "low_sample_warning",
      category: "OBSERVATION",
      title: "Limited Sample Sizes Detected",
      description: `${smallSampleTemplates.length} template(s) have fewer than 20 attempted sends. Percentage metrics may fluctuate significantly with a single reply or bounce.`,
      metricBadge: `< 20 Sends`,
      recommendation: "Avoid declaring winner templates until each version reaches at least 20 delivered messages.",
    });
  }

  // 3. Conversion leak observation (High replies, low meetings)
  const conversionLeak = templateItems.find((t) => t.repliedCount >= 3 && t.meetingRate === 0);
  if (conversionLeak) {
    insights.push({
      type: "conversion_leak",
      category: "OBSERVATION",
      title: `Engagement Without Meetings: "${conversionLeak.templateName}"`,
      description: `Received ${conversionLeak.repliedCount} replies but 0 booked meetings have been attributed yet.`,
      metricBadge: `${conversionLeak.repliedCount} Replies · 0 Meetings`,
      recommendation: "Review incoming reply threads to verify if prospects need faster call scheduling or clearer qualification questions.",
    });
  }

  // 4. Working hypothesis
  if (informativeTemplates.length > 0) {
    insights.push({
      type: "top_performer",
      category: "HYPOTHESIS",
      title: "Audience Alignment Hypothesis",
      description: "Templates addressing verified pain points (operational audits, guest feedback) show higher engagement when directed to Operations/General Managers than broad sales pitches.",
      recommendation: "Test pairing segment-specific proof points with direct questions in future campaigns.",
    });
  }

  const overallDelivDenom = Math.max(1, totalAttempted);
  const overallReplyDenom = Math.max(1, totalDelivered);

  return {
    overview: {
      totalTemplatesEvaluated: templateItems.length,
      totalAssigned,
      totalAttempted,
      totalProviderAccepted,
      totalDelivered,
      totalBounced,
      totalReplies,
      totalPositiveReplies,
      totalMeetingsBooked,
      overallDeliveryRate: totalAttempted > 0 ? Number(((totalDelivered / overallDelivDenom) * 100).toFixed(1)) : 0,
      overallReplyRate: totalDelivered > 0 ? Number(((totalReplies / overallReplyDenom) * 100).toFixed(1)) : 0,
      overallMeetingRate: totalDelivered > 0 ? Number(((totalMeetingsBooked / overallReplyDenom) * 100).toFixed(1)) : 0,
    },
    templates: templateItems,
    insights,
    availableFilters: {
      campaigns: allCampaigns,
      segments: Array.from(segmentsSet).sort(),
      personas: Array.from(personasSet).sort(),
    },
  };
}

