// Prisma rows -> API DTOs (src/shared/types.ts). Keeps response shapes in one place.
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { env, liveSendingBlocker } from "../config.js";
import type {
  CampaignCounts,
  CampaignDetailDto,
  CampaignSummaryDto,
  ContactDto,
  ContactListDto,
  EnrichmentDto,
  SendDto,
  SuppressionDto,
  TemplateDto,
} from "../../shared/types.js";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function asStringRecord(value: Prisma.JsonValue | undefined): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) if (v !== null && v !== undefined) out[k] = String(v);
  return out;
}

// ---------------------------------------------------------------------------
// Contacts & lists
// ---------------------------------------------------------------------------

export const contactInclude = {
  memberships: { include: { contactList: { select: { id: true, name: true } } } },
} satisfies Prisma.ContactInclude;

type ContactRow = Prisma.ContactGetPayload<{ include: typeof contactInclude }>;

let cachedSuppressions: { map: Map<string, { reason: any; createdAt: Date }>; expiresAt: number } | null = null;
const SUPPRESSIONS_CACHE_TTL_MS = 60_000;

export function invalidateSuppressionsCache(): void {
  cachedSuppressions = null;
}

export async function getSuppressionMap(): Promise<Map<string, { reason: any; createdAt: Date }>> {
  const now = Date.now();
  if (cachedSuppressions && cachedSuppressions.expiresAt > now) {
    return cachedSuppressions.map;
  }
  const all = await prisma.suppressionEntry.findMany({ select: { email: true, reason: true, createdAt: true } });
  const map = new Map(all.map((s) => [s.email.toLowerCase(), { reason: s.reason, createdAt: s.createdAt }]));
  cachedSuppressions = { map, expiresAt: now + SUPPRESSIONS_CACHE_TTL_MS };
  return map;
}

export async function toContactDtos(rows: ContactRow[]): Promise<ContactDto[]> {
  if (!rows.length) return [];
  const byEmail = await getSuppressionMap();
  return rows.map((c) => {
    const s = byEmail.get(c.email.toLowerCase());
    return {
      id: c.id,
      email: c.email,
      firstName: c.firstName,
      lastName: c.lastName,
      company: c.company,
      title: c.title,
      phone: c.phone,
      hotelSegment: c.hotelSegment,
      hotelSegmentConfidence: c.hotelSegmentConfidence,
      hotelSegmentStatus: c.hotelSegmentStatus,
      contactPersona: c.contactPersona,
      contactPersonaConfidence: c.contactPersonaConfidence,
      contactPersonaStatus: c.contactPersonaStatus,
      customFields: asStringRecord(c.customFields),
      source: c.source,
      importedAt: c.importedAt.toISOString(),
      updatedAt: c.updatedAt.toISOString(),
      lists: c.memberships.map((m) => m.contactList),
      suppression: s ? { reason: s.reason, createdAt: s.createdAt.toISOString() } : null,
    };
  });
}

export function toListDto(l: { id: string; name: string; description: string | null; createdAt: Date; updatedAt: Date; _count: { members: number } }): ContactListDto {
  return {
    id: l.id,
    name: l.name,
    description: l.description,
    memberCount: l._count.members,
    createdAt: l.createdAt.toISOString(),
    updatedAt: l.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------

export function toTemplateDto(t: Prisma.TemplateGetPayload<{ include: { _count: { select: { campaigns: true } } } }>): TemplateDto {
  return {
    id: t.id,
    name: t.name,
    subject: t.subject,
    bodyHtml: t.bodyHtml,
    bodyText: t.bodyText,
    description: t.description,
    version: t.version,
    campaignCount: (t as any)._count?.campaigns ?? 0,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Campaigns
// ---------------------------------------------------------------------------

const userRef = { select: { id: true, name: true } } as const;

export const campaignInclude = {
  template: { select: { id: true, name: true, subject: true, version: true } },
  contactList: { select: { id: true, name: true, _count: { select: { members: true } } } },
  createdBy: userRef,
  approvedByUser: userRef,
  approvalRequestedBy: userRef,
  campaignTemplates: {
    include: { template: { select: { id: true, name: true, subject: true, version: true } } },
    orderBy: { priority: "asc" },
  },
  rules: {
    include: { template: { select: { id: true, name: true } } },
    orderBy: { priority: "asc" },
  },
  sequenceSteps: {
    include: { template: { select: { id: true, name: true, subject: true } } },
    orderBy: { stepIndex: "asc" },
  },
  _count: { select: { recipientOverrides: true } },
} satisfies Prisma.CampaignInclude;

export const campaignSummaryInclude = {
  template: { select: { id: true, name: true, subject: true, version: true } },
  contactList: { select: { id: true, name: true, _count: { select: { members: true } } } },
  createdBy: userRef,
  approvedByUser: userRef,
} satisfies Prisma.CampaignInclude;

export type CampaignSummaryRow = Prisma.CampaignGetPayload<{ include: typeof campaignSummaryInclude }>;
type CampaignRow = Prisma.CampaignGetPayload<{ include: typeof campaignInclude }>;

const emptyCounts = (): CampaignCounts => ({
  total: 0,
  pending: 0,
  sent: 0,
  failed: 0,
  unknown: 0,
  skipped: 0,
  cancelled: 0,
  bounced: 0,
  replied: 0,
  unsubscribed: 0,
});

export async function loadCampaignCounts(campaignIds: string[]): Promise<Map<string, CampaignCounts>> {
  const map = new Map<string, CampaignCounts>(campaignIds.map((id) => [id, emptyCounts()]));
  if (!campaignIds.length) return map;

  const rows = await prisma.$queryRaw<{
    campaignId: string;
    total: bigint;
    pending: bigint;
    sent: bigint;
    failed: bigint;
    unknown: bigint;
    skipped: bigint;
    cancelled: bigint;
    bounced: bigint;
    replied: bigint;
    unsubscribed: bigint;
  }[]>`
    SELECT "campaignId",
           COUNT(*) as total,
           COUNT(*) FILTER (WHERE status IN ('PENDING', 'CLAIMED')) as pending,
           COUNT(*) FILTER (WHERE status = 'SENT') as sent,
           COUNT(*) FILTER (WHERE status = 'FAILED') as failed,
           COUNT(*) FILTER (WHERE status = 'UNKNOWN') as unknown,
           COUNT(*) FILTER (WHERE status = 'SKIPPED') as skipped,
           COUNT(*) FILTER (WHERE status = 'CANCELLED') as cancelled,
           COUNT("bouncedAt") as bounced,
           COUNT("repliedAt") as replied,
           COUNT("unsubscribedAt") as unsubscribed
    FROM sends
    WHERE "campaignId" = ANY(${campaignIds})
    GROUP BY "campaignId"`;

  for (const row of rows) {
    const c = map.get(row.campaignId);
    if (!c) continue;
    c.total = Number(row.total);
    c.pending = Number(row.pending);
    c.sent = Number(row.sent);
    c.failed = Number(row.failed);
    c.unknown = Number(row.unknown);
    c.skipped = Number(row.skipped);
    c.cancelled = Number(row.cancelled);
    c.bounced = Number(row.bounced);
    c.replied = Number(row.replied);
    c.unsubscribed = Number(row.unsubscribed);
  }
  return map;
}

export function toCampaignSummary(c: CampaignSummaryRow | CampaignRow, counts: CampaignCounts): CampaignSummaryDto {
  return {
    id: c.id,
    name: c.name,
    status: c.status,
    template: c.template,
    list: { id: c.contactList.id, name: c.contactList.name, memberCount: c.contactList._count.members },
    counts,
    createdBy: c.createdBy,
    approvedBy: c.approvedByUser,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
    approvedAt: iso(c.approvedAt),
    startedAt: iso(c.startedAt),
    completedAt: iso(c.completedAt),
    pausedReason: c.pausedReason,
  };
}

export async function toCampaignSummaries(rows: (CampaignSummaryRow | CampaignRow)[]): Promise<CampaignSummaryDto[]> {
  const counts = await loadCampaignCounts(rows.map((r) => r.id));
  return rows.map((r) => toCampaignSummary(r, counts.get(r.id)!));
}

export async function toCampaignDetail(c: CampaignRow): Promise<CampaignDetailDto> {
  const counts = (await loadCampaignCounts([c.id])).get(c.id)!;
  const templates = c.campaignTemplates.length
    ? c.campaignTemplates.map((ct) => ({
        id: ct.id,
        campaignId: ct.campaignId,
        templateId: ct.templateId,
        name: ct.template.name,
        subject: ct.template.subject,
        version: ct.template.version,
        isFallback: ct.isFallback,
        priority: ct.priority,
      }))
    : [
        {
          id: `default-${c.template.id}`,
          campaignId: c.id,
          templateId: c.template.id,
          name: c.template.name,
          subject: c.template.subject,
          version: c.template.version,
          isFallback: true,
          priority: 0,
        },
      ];

  const rules = c.rules.map((r) => ({
    id: r.id,
    campaignId: r.campaignId,
    templateId: r.templateId,
    templateName: r.template.name,
    priority: r.priority,
    hotelSegment: r.hotelSegment,
    contactPersona: r.contactPersona,
    requiresVerified: r.requiresVerified,
    minConfidence: r.minConfidence,
    city: r.city,
    description: r.description,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  }));

  return {
    ...toCampaignSummary(c, counts),
    description: c.description,
    fromName: c.fromName,
    fromEmail: c.fromEmail ?? env.SMTP_FROM_EMAIL ?? null,
    replyTo: c.replyTo,
    sendRatePerMinute: c.sendRatePerMinute,
    approvalRequestedBy: c.approvalRequestedBy,
    approvalRequestedAt: iso(c.approvalRequestedAt),
    cancelledAt: iso(c.cancelledAt),
    snapshot: c.subject && c.bodyHtml ? { subject: c.subject, bodyHtml: c.bodyHtml, bodyText: c.bodyText } : null,
    liveSendingBlocker: liveSendingBlocker(),
    automationMode: c.automationMode,
    sequenceSteps: c.sequenceSteps.map((st) => ({
      id: st.id,
      campaignId: st.campaignId,
      stepIndex: st.stepIndex,
      purpose: st.purpose,
      delayDays: st.delayDays,
      delayBusinessDaysOnly: st.delayBusinessDaysOnly,
      subjectMode: st.subjectMode as "THREADED" | "STANDALONE",
      customSubject: st.customSubject,
      templateId: st.templateId,
      templateName: st.template.name,
      templateSubject: st.template.subject,
      promptInstructions: st.promptInstructions,
      createdAt: st.createdAt.toISOString(),
      updatedAt: st.updatedAt.toISOString(),
    })),
    templates,
    rules,
    overridesCount: c._count.recipientOverrides,
  };
}

export function toSendDto(s: {
  id: string;
  email: string;
  contactId: string | null;
  subject?: string | null;
  status: SendDto["status"];
  skipReason: string | null;
  attempts: number;
  lastError: string | null;
  sentAt: Date | null;
  bouncedAt: Date | null;
  repliedAt: Date | null;
  unsubscribedAt: Date | null;
  updatedAt: Date;
  templateId?: string | null;
  templateVersion?: number | null;
  assignmentReason?: string | null;
  stepIndex?: number;
  scheduledFor?: Date | null;
  approvedAt?: Date | null;
  inReplyToId?: string | null;
  isCustom?: boolean;
}): SendDto {
  return {
    id: s.id,
    email: s.email,
    contactId: s.contactId,
    subject: s.subject ?? null,
    status: s.status,
    skipReason: s.skipReason,
    attempts: s.attempts,
    lastError: s.lastError,
    sentAt: iso(s.sentAt),
    bouncedAt: iso(s.bouncedAt),
    repliedAt: iso(s.repliedAt),
    unsubscribedAt: iso(s.unsubscribedAt),
    updatedAt: s.updatedAt.toISOString(),
    templateId: s.templateId ?? null,
    templateVersion: s.templateVersion ?? null,
    assignmentReason: s.assignmentReason ?? null,
    stepIndex: s.stepIndex ?? 0,
    scheduledFor: iso(s.scheduledFor),
    approvedAt: iso(s.approvedAt),
    inReplyToId: s.inReplyToId ?? null,
    isCustom: Boolean(s.isCustom),
  };
}

// ---------------------------------------------------------------------------
// Suppressions & enrichment
// ---------------------------------------------------------------------------

export function toSuppressionDto(s: { id: string; email: string; reason: SuppressionDto["reason"]; source: string; metadata: Prisma.JsonValue; createdAt: Date }): SuppressionDto {
  const meta = asStringRecord(s.metadata);
  return { id: s.id, email: s.email, reason: s.reason, source: s.source, note: meta.note ?? null, createdAt: s.createdAt.toISOString() };
}

export function toEnrichmentDto(
  e: Prisma.EnrichmentGetPayload<object>,
  currentValue: string | null
): EnrichmentDto {
  const evidence = asStringRecord(e.evidence);
  return {
    id: e.id,
    contactId: e.contactId,
    field: e.field,
    value: e.value,
    source: e.source,
    url: evidence.url ?? null,
    note: evidence.note ?? null,
    confidence: e.confidence,
    status: e.status,
    verifiedBy: e.verifiedBy,
    verifiedAt: iso(e.verifiedAt),
    appliedAt: iso(e.appliedAt),
    currentValue,
    createdAt: e.createdAt.toISOString(),
  };
}
