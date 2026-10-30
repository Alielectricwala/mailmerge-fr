// Query keys and data hooks — one place per resource, so invalidation is consistent
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { api, qs } from "./api";
import type {
  ActivityDto,
  CampaignDetailDto,
  CampaignReviewDto,
  CampaignStatus,
  CampaignSummaryDto,
  ContactDto,
  ContactListDto,
  EnrichmentDto,
  MailboxStatusDto,
  OverviewDto,
  SendDto,
  SuppressionDto,
  TemplateDto,
  WorkspaceTemplateAnalyticsDto,
  TemplateAnalyticsQuery,
} from "@shared/types";
import type { TeamMemberDto } from "@shared/auth";
import type { WriterContextDto } from "@shared/template-writer";

export const keys = {
  overview: ["overview"] as const,
  contacts: (p: Record<string, unknown>) => ["contacts", p] as const,
  contact: (id: string) => ["contacts", "detail", id] as const,
  contactFields: ["contacts", "fields"] as const,
  imports: ["contacts", "imports"] as const,
  lists: ["lists"] as const,
  templates: (search = "") => ["templates", search] as const,
  template: (id: string) => ["templates", "detail", id] as const,
  writer: ["templates", "writer"] as const,
  campaigns: (p: Record<string, unknown>) => ["campaigns", p] as const,
  campaign: (id: string) => ["campaigns", "detail", id] as const,
  review: (id: string) => ["campaigns", "review", id] as const,
  sends: (id: string, p: Record<string, unknown>) => ["campaigns", "sends", id, p] as const,
  suppressions: (p: Record<string, unknown>) => ["suppressions", p] as const,
  enrichment: (contactId: string) => ["enrichment", contactId] as const,
  mailbox: ["mailbox"] as const,
  team: ["team"] as const,
  activity: (page: number) => ["activity", page] as const,
  templateAnalytics: (p: Record<string, unknown> = {}) => ["analytics", "templates", p] as const,
};

export type ContactDetail = ContactDto & { history: (SendDto & { campaign: { id: string; name: string } })[] };
export type SendDetail = SendDto & { subject: string; html: string; text: string; events: { id: string; type: string; occurredAt: string; detail: Record<string, unknown> }[] };
export type CampaignDetail = CampaignDetailDto & { waitingReason: string | null };
export interface ImportBatchDto {
  id: string;
  fileName: string;
  list: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  totalRows: number;
  created: number;
  updated: number;
  unchanged: number;
  skipped: number;
  duplicatePolicy: string;
  createdAt: string;
}

export const useOverview = () => useQuery({ queryKey: keys.overview, queryFn: () => api.get<OverviewDto>("/api/overview"), refetchInterval: 30_000 });

export const useContacts = (p: { page: number; search: string; listId?: string; filter?: string }) =>
  useQuery({
    queryKey: keys.contacts(p),
    queryFn: () => api.get<ContactDto[]>(`/api/contacts${qs({ page: p.page, pageSize: 25, search: p.search, listId: p.listId, filter: p.filter })}`),
    placeholderData: keepPreviousData,
  });

export const useContact = (id: string | null) =>
  useQuery({ queryKey: keys.contact(id ?? ""), queryFn: () => api.get<ContactDetail>(`/api/contacts/${id}`), enabled: Boolean(id) });

export const useContactFields = () =>
  useQuery({ queryKey: keys.contactFields, queryFn: () => api.get<{ name: string; count: number }[]>("/api/contacts/fields"), staleTime: 60_000 });

/** Merge fields with coverage, and whether AI drafting is switched on */
export const useWriterContext = (enabled = true) =>
  useQuery({ queryKey: keys.writer, queryFn: () => api.get<WriterContextDto>("/api/templates/ai/context"), staleTime: 60_000, enabled });

export const useImports = () => useQuery({ queryKey: keys.imports, queryFn: () => api.get<ImportBatchDto[]>("/api/contacts/imports") });

export const useLists = () => useQuery({ queryKey: keys.lists, queryFn: () => api.get<ContactListDto[]>("/api/lists") });

export const useTemplates = (search = "") =>
  useQuery({
    queryKey: keys.templates(search),
    queryFn: () => api.get<TemplateDto[]>(`/api/templates${qs({ search })}`),
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });

export const useTemplate = (id: string | undefined) =>
  useQuery({ queryKey: keys.template(id ?? ""), queryFn: () => api.get<TemplateDto>(`/api/templates/${id}`), enabled: Boolean(id) });

export const useTemplateAnalytics = (p: TemplateAnalyticsQuery = {}) =>
  useQuery({
    queryKey: keys.templateAnalytics(p as Record<string, unknown>),
    queryFn: () => api.get<WorkspaceTemplateAnalyticsDto>(`/api/analytics/templates${qs(p)}`),
    placeholderData: keepPreviousData,
  });

export const useCampaigns = (p: { status?: CampaignStatus; search?: string }) =>
  useQuery({
    queryKey: keys.campaigns(p),
    queryFn: () => api.get<CampaignSummaryDto[]>(`/api/campaigns${qs(p)}`),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.data.some((c) => c.status === "SENDING") ? 5000 : false),
  });

export const useCampaign = (id: string) =>
  useQuery({
    queryKey: keys.campaign(id),
    queryFn: () => api.get<CampaignDetail>(`/api/campaigns/${id}`),
    refetchInterval: (q) => (q.state.data?.data.status === "SENDING" ? 4000 : false),
  });

export const useReview = (id: string, enabled: boolean) =>
  useQuery({ queryKey: keys.review(id), queryFn: () => api.get<CampaignReviewDto>(`/api/campaigns/${id}/review`), enabled });

export const useSends = (id: string, p: { page: number; filter: string; search: string }, live: boolean) =>
  useQuery({
    queryKey: keys.sends(id, p),
    queryFn: () => api.get<SendDto[]>(`/api/campaigns/${id}/sends${qs({ page: p.page, pageSize: 25, filter: p.filter === "all" ? undefined : p.filter, search: p.search })}`),
    placeholderData: keepPreviousData,
    refetchInterval: live ? 4000 : false,
  });

export const useSuppressions = (p: { page: number; search: string; reason?: string }) =>
  useQuery({
    queryKey: keys.suppressions(p),
    queryFn: () => api.get<SuppressionDto[]>(`/api/suppressions${qs({ page: p.page, pageSize: 25, search: p.search, reason: p.reason })}`),
    placeholderData: keepPreviousData,
  });

export const useEnrichment = (contactId: string | null) =>
  useQuery({ queryKey: keys.enrichment(contactId ?? ""), queryFn: () => api.get<EnrichmentDto[]>(`/api/enrichment/contact/${contactId}`), enabled: Boolean(contactId) });

export const useMailbox = () => useQuery({ queryKey: keys.mailbox, queryFn: () => api.get<MailboxStatusDto>("/api/mailbox") });

export const useTeam = (enabled = true) => useQuery({ queryKey: keys.team, queryFn: () => api.get<TeamMemberDto[]>("/api/users"), enabled });

export const useActivity = (page: number, enabled = true) =>
  useQuery({ queryKey: keys.activity(page), queryFn: () => api.get<ActivityDto[]>(`/api/activity${qs({ page, pageSize: 30 })}`), enabled, placeholderData: keepPreviousData });

/** Invalidate everything a campaign change can affect */
export function useInvalidate() {
  const qc = useQueryClient();
  return (...prefixes: string[]) => Promise.all(prefixes.map((p) => qc.invalidateQueries({ queryKey: [p] })));
}
