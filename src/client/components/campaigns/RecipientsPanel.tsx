// Per-recipient delivery log with filters, and a drawer showing the exact message sent
import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  CheckCircle,
  Clock,
  Download,
  Mail,
  MessageSquareReply,
  OctagonX,
  Pause,
  Play,
  Square,
  UserMinus,
} from "lucide-react";
import {
  RECIPIENT_SEQUENCE_STATE_LABELS,
  type CampaignCounts,
  type SendDto,
  type CampaignRecipientStateDto,
  type RecipientSequenceState,
} from "@shared/types";
import { api, errorMessage } from "../../lib/api";
import { useInvalidate, useSends, type SendDetail } from "../../lib/queries";
import { useDebounced } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { formatDateTime } from "../../lib/format";
import { Card } from "../ui/Card";
import { Badge, DeliveryStatusBadge } from "../ui/Badge";
import { Button, buttonClasses } from "../ui/Button";
import { Checkbox, SearchInput, SelectField, TextField } from "../ui/Field";
import { DataTable, Pagination, type Column } from "../ui/DataTable";
import { FilterChips } from "../ui/Navigation";
import { Callout, EmptyState, ErrorState } from "../ui/Feedback";
import { Drawer } from "../ui/Overlay";
import { PageLoader } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { EmailPreview } from "../email/EmailPreview";

type FilterKey =
  | "all"
  | "awaiting_approval"
  | "scheduled"
  | "pending"
  | "sent"
  | "failed"
  | "unknown"
  | "skipped"
  | "cancelled"
  | "bounced"
  | "replied"
  | "unsubscribed";

const EVENT_LABELS: Record<string, string> = { HARD_BOUNCE: "Bounced", SOFT_BOUNCE: "Delivery delayed", REPLY: "Replied", UNSUBSCRIBE: "Unsubscribed" };

function Engagement({ s }: { s: SendDto }) {
  return (
    <div className="flex gap-1.5">
      {s.repliedAt && <Badge tone="success"><MessageSquareReply className="h-3 w-3" /> Replied</Badge>}
      {s.bouncedAt && <Badge tone="danger"><OctagonX className="h-3 w-3" /> Bounced</Badge>}
      {s.unsubscribedAt && <Badge tone="neutral"><UserMinus className="h-3 w-3" /> Unsubscribed</Badge>}
    </div>
  );
}

function OutcomeReviewForm({
  campaignId,
  sendId,
  send,
}: {
  campaignId: string;
  sendId: string;
  send: SendDetail;
}) {
  const toast = useToast();
  const invalidate = useInvalidate();

  // Find latest reply event detail if any
  const replyEvent = [...send.events].reverse().find((e) => e.type === "REPLY");
  const detail = (replyEvent?.detail as Record<string, unknown> | undefined) ?? {};

  const [classification, setClassification] = useState<string>(
    String(detail.classification || "")
  );
  const [meetingBooked, setMeetingBooked] = useState<boolean>(
    Boolean(detail.meetingBooked)
  );
  const [note, setNote] = useState<string>(String(detail.note || ""));

  const save = useMutation({
    mutationFn: () =>
      api.post(`/api/campaigns/${campaignId}/sends/${sendId}/outcome`, {
        replyClassification: classification ? classification : undefined,
        meetingBooked,
        note: note ? note : undefined,
      }),
    onSuccess: async () => {
      await invalidate("campaigns", "overview");
      toast.success("Outcome saved", "Attribution metrics updated.");
    },
    onError: (err) => toast.error("Could not save outcome", errorMessage(err)),
  });

  return (
    <div className="rounded-lg border border-line bg-surface-sunken/40 p-3 space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-ink uppercase tracking-wider">
          Reply Outcome & Meeting Review
        </span>
        {classification && (
          <Badge
            tone={
              classification === "POSITIVE"
                ? "success"
                : classification === "NEGATIVE" || classification === "UNSUBSCRIBE"
                ? "danger"
                : classification === "OBJECTION" || classification === "OUT_OF_OFFICE"
                ? "warning"
                : "neutral"
            }
          >
            {classification}
          </Badge>
        )}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
        <SelectField
          label="Sentiment Classification"
          value={classification}
          onChange={(e) => setClassification(e.target.value)}
          options={[
            { value: "", label: "Unclassified" },
            { value: "POSITIVE", label: "Positive interest" },
            { value: "NEUTRAL", label: "Neutral / Needs follow-up" },
            { value: "OBJECTION", label: "Objection / Needs clarification" },
            { value: "NEGATIVE", label: "Negative / Not interested" },
            { value: "UNSUBSCRIBE", label: "Unsubscribe request" },
            { value: "OUT_OF_OFFICE", label: "Out of office / Away" },
          ]}
        />
        <div className="pt-5">
          <Checkbox
            label="Meeting booked from this outreach"
            checked={meetingBooked}
            onChange={(e) => setMeetingBooked(e.target.checked)}
          />
        </div>
      </div>

      <TextField
        label="Notes / Next steps"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        placeholder="e.g. Call booked for Thursday 2pm with GM"
      />

      <div className="flex justify-end">
        <Button
          size="sm"
          variant="primary"
          loading={save.isPending}
          onClick={() => save.mutate()}
        >
          Save Outcome
        </Button>
      </div>
    </div>
  );
}

function SendDrawer({ campaignId, sendId, fromLine, onClose }: { campaignId: string; sendId: string; fromLine: string; onClose: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const send = useQuery({ queryKey: ["campaigns", "send", sendId], queryFn: () => api.get<SendDetail>(`/api/campaigns/${campaignId}/sends/${sendId}`) });
  const s = send.data?.data;

  const seqQuery = useQuery({
    queryKey: ["campaigns", campaignId, "recipient-sequence", s?.email],
    queryFn: () =>
      api
        .get<{
          recipient: CampaignRecipientStateDto | null;
          sends: SendDto[];
          pendingFollowUp: SendDto | null;
          canApprove: boolean;
          canPause: boolean;
          canResume: boolean;
          canStop: boolean;
        }>(`/api/campaigns/${campaignId}/recipients/${encodeURIComponent(s!.email)}/sequence`)
        .then((r) => r.data),
    enabled: Boolean(s?.email),
  });

  const resolve = useMutation({
    mutationFn: (outcome: "sent" | "retry") => api.post(`/api/campaigns/${campaignId}/sends/${sendId}/resolve`, { outcome }),
    onSuccess: async (_r, outcome) => {
      await invalidate("campaigns", "overview");
      toast.success(outcome === "sent" ? "Marked as delivered" : "Queued to send again");
      onClose();
    },
    onError: (err) => toast.error("Couldn't update", errorMessage(err)),
  });

  const approveFollowUp = useMutation({
    mutationFn: (followUpSendId: string) =>
      api.post(`/api/campaigns/${campaignId}/sends/${followUpSendId}/approve`),
    onSuccess: async () => {
      await invalidate("campaigns", "overview");
      await seqQuery.refetch();
      await send.refetch();
      toast.success("Follow-up approved", "Queued for sending when due.");
    },
    onError: (err) => toast.error("Could not approve follow-up", errorMessage(err)),
  });

  const pauseRecipient = useMutation({
    mutationFn: () =>
      api.post(`/api/campaigns/${campaignId}/recipients/${encodeURIComponent(s!.email)}/pause`),
    onSuccess: async () => {
      await invalidate("campaigns", "overview");
      await seqQuery.refetch();
      toast.success("Recipient sequence paused");
    },
    onError: (err) => toast.error("Could not pause recipient", errorMessage(err)),
  });

  const resumeRecipient = useMutation({
    mutationFn: () =>
      api.post(`/api/campaigns/${campaignId}/recipients/${encodeURIComponent(s!.email)}/resume`),
    onSuccess: async () => {
      await invalidate("campaigns", "overview");
      await seqQuery.refetch();
      toast.success("Recipient sequence resumed");
    },
    onError: (err) => toast.error("Could not resume recipient", errorMessage(err)),
  });

  const stopRecipient = useMutation({
    mutationFn: () =>
      api.post(`/api/campaigns/${campaignId}/recipients/${encodeURIComponent(s!.email)}/stop`),
    onSuccess: async () => {
      await invalidate("campaigns", "overview");
      await seqQuery.refetch();
      toast.success("Recipient sequence stopped", "Future follow-ups cancelled.");
    },
    onError: (err) => toast.error("Could not stop recipient", errorMessage(err)),
  });

  return (
    <Drawer open onClose={onClose} title={s?.email ?? "Message"} subtitle={s && <DeliveryStatusBadge status={s.status} />} width="lg">
      {send.isPending ? (
        <PageLoader />
      ) : send.isError ? (
        <ErrorState error={send.error} onRetry={() => send.refetch()} />
      ) : (
        s && (
          <div className="space-y-5">
            {s.status === "UNKNOWN" && (
              <Callout tone="warning" title="We can't tell whether this was delivered">
                <p>The connection broke while handing this message to the mailbox, so it may or may not have gone out. Check the Sent folder in SpaceMail, then choose:</p>
                {can("campaigns.control") && (
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={() => resolve.mutate("sent")} loading={resolve.isPending && resolve.variables === "sent"}>
                      It was delivered
                    </Button>
                    <Button size="sm" variant="primary" onClick={() => resolve.mutate("retry")} loading={resolve.isPending && resolve.variables === "retry"}>
                      It wasn't — send again
                    </Button>
                  </div>
                )}
              </Callout>
            )}
            {s.skipReason && <Callout tone="info" title="Skipped">{s.skipReason}</Callout>}
            {s.lastError && s.status !== "UNKNOWN" && <Callout tone="danger" title="Delivery problem">{s.lastError}</Callout>}

            {/* Recipient Sequence Status & State Controls */}
            {seqQuery.data?.recipient && (
              <div className="rounded-lg border border-line bg-surface-muted/40 p-3.5 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-ink">Sequence Status:</span>
                    {(() => {
                      const stateMeta =
                        RECIPIENT_SEQUENCE_STATE_LABELS[
                          seqQuery.data.recipient.state as RecipientSequenceState
                        ];
                      return (
                        <Badge tone={stateMeta?.tone ?? "neutral"}>
                          {stateMeta?.label ?? seqQuery.data.recipient.state}
                        </Badge>
                      );
                    })()}
                  </div>

                  <div className="flex items-center gap-1.5">
                    {seqQuery.data.canPause && can("campaigns.control") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => pauseRecipient.mutate()}
                        loading={pauseRecipient.isPending}
                        icon={<Pause className="h-3 w-3" />}
                      >
                        Pause
                      </Button>
                    )}
                    {seqQuery.data.canResume && can("campaigns.control") && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => resumeRecipient.mutate()}
                        loading={resumeRecipient.isPending}
                        icon={<Play className="h-3 w-3" />}
                      >
                        Resume
                      </Button>
                    )}
                    {seqQuery.data.canStop && can("campaigns.control") && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => stopRecipient.mutate()}
                        loading={stopRecipient.isPending}
                        icon={<Square className="h-3 w-3 text-danger" />}
                      >
                        Stop Sequence
                      </Button>
                    )}
                  </div>
                </div>

                {seqQuery.data.recipient.state === "REPLY_RECEIVED" && (
                  <Callout tone="success" title="Reply Received — Automation Stopped">
                    <p className="text-xs">
                      A response was detected from this contact. All scheduled future outreach has been cancelled immediately to prevent automated selling. Human action is required to review and respond.
                    </p>
                  </Callout>
                )}

                {seqQuery.data.canApprove && seqQuery.data.pendingFollowUp && can("campaigns.approve") && (
                  <div className="flex items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3">
                    <div className="text-xs">
                      <div className="font-semibold text-ink">
                        Follow-up Step {seqQuery.data.pendingFollowUp.stepIndex} awaiting approval
                      </div>
                      <div className="text-[11px] text-ink-muted mt-0.5">
                        Subject: "{seqQuery.data.pendingFollowUp.subject}"
                      </div>
                    </div>
                    <Button
                      size="sm"
                      variant="primary"
                      loading={approveFollowUp.isPending}
                      onClick={() => approveFollowUp.mutate(seqQuery.data.pendingFollowUp!.id)}
                      icon={<CheckCircle className="h-3.5 w-3.5" />}
                    >
                      Approve Step {seqQuery.data.pendingFollowUp.stepIndex}
                    </Button>
                  </div>
                )}

                {seqQuery.data.recipient.pausedReason && (
                  <div className="text-xs text-ink-muted">
                    <strong>Pause reason:</strong> {seqQuery.data.recipient.pausedReason}
                  </div>
                )}

                {seqQuery.data.sends && seqQuery.data.sends.length > 1 && (
                  <div className="space-y-1.5 pt-1">
                    <span className="text-[11px] font-semibold text-ink-subtle uppercase tracking-wider block">
                      Sequence Touch Timeline
                    </span>
                    <div className="space-y-1">
                      {seqQuery.data.sends.map((stepSend) => (
                        <div
                          key={stepSend.id}
                          className={`flex items-center justify-between rounded border px-2.5 py-1.5 text-xs ${
                            stepSend.id === s.id ? "border-brand bg-brand-soft/20" : "border-line bg-surface"
                          }`}
                        >
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-ink">
                              {stepSend.stepIndex === 0 ? "Initial" : `Step ${stepSend.stepIndex}`}
                            </span>
                            <span className="text-[11px] text-ink-subtle line-clamp-1 max-w-[200px]">
                              {stepSend.subject}
                            </span>
                          </div>
                          <div className="flex items-center gap-2">
                            <DeliveryStatusBadge status={stepSend.status} />
                            <span className="text-[11px] text-ink-subtle">
                              {stepSend.sentAt
                                ? formatDateTime(stepSend.sentAt)
                                : stepSend.scheduledFor
                                ? `Due: ${formatDateTime(stepSend.scheduledFor)}`
                                : "Pending"}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            <dl className="grid grid-cols-2 gap-4 text-[13px]">
              <div>
                <dt className="text-xs text-ink-subtle">Timing</dt>
                <dd className="mt-0.5">
                  {s.sentAt
                    ? formatDateTime(s.sentAt)
                    : s.scheduledFor
                    ? `Scheduled: ${formatDateTime(s.scheduledFor)}`
                    : "Pending"}
                </dd>
              </div>
              <div><dt className="text-xs text-ink-subtle">Attempts</dt><dd className="mt-0.5 tabular">{s.attempts}</dd></div>
            </dl>

            {/* Outcome and Reply Management */}
            {can("campaigns.manage") && (Boolean(s.repliedAt) || s.events.some((e) => e.type === "REPLY")) && (
              <OutcomeReviewForm campaignId={campaignId} sendId={sendId} send={s} />
            )}

            {s.events.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-medium">What happened next</p>
                <ol className="space-y-2">
                  {s.events.map((e) => {
                    const d = (e.detail as Record<string, unknown>) || {};
                    const cls = String(d.classification || "");
                    const isMeeting = Boolean(d.meetingBooked);
                    return (
                      <li key={e.id} className="rounded-lg border border-line px-3 py-2 text-[13px]">
                        <div className="flex justify-between items-center gap-3">
                          <div className="flex items-center gap-2">
                            <span className="font-medium">{EVENT_LABELS[e.type] ?? e.type}</span>
                            {cls && (
                              <Badge
                                tone={
                                  cls === "POSITIVE"
                                    ? "success"
                                    : cls === "NEGATIVE" || cls === "UNSUBSCRIBE"
                                    ? "danger"
                                    : cls === "OBJECTION" || cls === "OUT_OF_OFFICE"
                                    ? "warning"
                                    : "neutral"
                                }
                              >
                                {cls}
                              </Badge>
                            )}
                            {isMeeting && <Badge tone="brand">Meeting Booked</Badge>}
                          </div>
                          <span className="text-xs text-ink-subtle">{formatDateTime(e.occurredAt)}</span>
                        </div>
                        {Boolean(d.snippet || d.diagnostic) && (
                          <p className="mt-1 text-xs text-ink-muted leading-relaxed">
                            {String(d.snippet ?? d.diagnostic)}
                          </p>
                        )}
                        {Boolean(d.note) && (
                          <p className="mt-1 text-xs text-ink italic">Note: {String(d.note)}</p>
                        )}
                      </li>
                    );
                  })}
                </ol>
              </div>
            )}

            {s.html ? (
              <EmailPreview from={fromLine} to={s.email} subject={s.subject} html={s.html} text={s.text} height={380} />
            ) : (
              <p className="text-[13px] text-ink-subtle">No message was prepared for this recipient.</p>
            )}
          </div>
        )
      )}
    </Drawer>
  );
}

export function RecipientsPanel({ campaignId, counts, live, fromLine, initialFilter }: { campaignId: string; counts: CampaignCounts; live: boolean; fromLine: string; initialFilter?: string }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [filter, setFilter] = useState<FilterKey>((initialFilter as FilterKey) || "all");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [openId, setOpenId] = useState<string | null>(null);
  const sends = useSends(campaignId, { page, filter, search: useDebounced(search) }, live);

  // Bulk actions
  const approveAll = useMutation({
    mutationFn: () => api.post<{ approvedCount: number }>(`/api/campaigns/${campaignId}/sends/approve-all`),
    onSuccess: async (res) => {
      await invalidate("campaigns", "overview");
      await sends.refetch();
      toast.success("Follow-ups approved", `${res.data.approvedCount} due follow-up emails approved for dispatch.`);
    },
    onError: (err) => toast.error("Could not approve follow-ups", errorMessage(err)),
  });

  const stopAll = useMutation({
    mutationFn: () => api.post<{ cancelledSendsCount: number }>(`/api/campaigns/${campaignId}/sequence/stop-all`),
    onSuccess: async (res) => {
      await invalidate("campaigns", "overview");
      await sends.refetch();
      toast.success("All follow-ups stopped", `${res.data.cancelledSendsCount} scheduled follow-ups cancelled.`);
    },
    onError: (err) => toast.error("Could not stop follow-ups", errorMessage(err)),
  });

  // Query awaiting approval count
  const awaitingQuery = useQuery({
    queryKey: ["campaigns", campaignId, "awaiting-count"],
    queryFn: () => api.get<SendDto[]>(`/api/campaigns/${campaignId}/sends?filter=awaiting_approval&pageSize=1`),
    staleTime: 10000,
  });
  const awaitingCount = awaitingQuery.data?.pagination?.total ?? 0;

  const options: { key: FilterKey; label: string; count?: number }[] = [
    { key: "all", label: "All", count: counts.total },
    { key: "awaiting_approval", label: "Awaiting Approval", count: awaitingCount },
    { key: "scheduled", label: "Scheduled" },
    { key: "pending", label: "Queued", count: counts.pending },
    { key: "sent", label: "Sent", count: counts.sent },
    { key: "failed", label: "Failed", count: counts.failed },
    { key: "unknown", label: "Needs review", count: counts.unknown },
    { key: "skipped", label: "Skipped", count: counts.skipped },
    { key: "cancelled", label: "Cancelled", count: counts.cancelled },
    { key: "replied", label: "Replied", count: counts.replied },
    { key: "bounced", label: "Bounced", count: counts.bounced },
    { key: "unsubscribed", label: "Unsubscribed", count: counts.unsubscribed },
  ];

  const columns: Column<SendDto>[] = [
    {
      key: "email",
      header: "Recipient",
      cell: (s) => (
        <div className="flex items-center gap-1.5">
          <span className="font-medium">{s.email}</span>
          {s.isCustom && <Badge tone="neutral">Customized</Badge>}
        </div>
      ),
    },
    {
      key: "step",
      header: "Step",
      cell: (s) => (
        <div className="flex items-center gap-1">
          <Badge tone={s.stepIndex === 0 ? "neutral" : "brand"}>
            {s.stepIndex === 0 ? "Initial" : `Step ${s.stepIndex ?? 1}`}
          </Badge>
          {s.inReplyToId && (
            <span className="text-[10px] text-ink-subtle font-medium bg-surface-muted px-1 py-0.5 rounded" title="Threaded in original conversation">
              Re:
            </span>
          )}
        </div>
      ),
    },
    {
      key: "status",
      header: "Delivery",
      cell: (s) => {
        const isAwaiting = s.status === "PENDING" && s.scheduledFor && !s.approvedAt;
        return (
          <div className="flex flex-col gap-0.5">
            <DeliveryStatusBadge status={s.status} />
            {isAwaiting && <Badge tone="warning">Awaiting Approval</Badge>}
          </div>
        );
      },
    },
    {
      key: "detail",
      header: "Details",
      cell: (s) => (
        <span className="line-clamp-1 max-w-xs text-xs text-ink-subtle">
          {s.status === "PENDING" && s.scheduledFor
            ? `Due: ${formatDateTime(s.scheduledFor)}`
            : s.skipReason ?? s.lastError ?? ""}
        </span>
      ),
    },
    { key: "engagement", header: "Response", cell: (s) => <Engagement s={s} /> },
    {
      key: "sentAt",
      header: "Timing",
      cell: (s) => (
        <span className="whitespace-nowrap text-ink-muted text-xs">
          {s.sentAt
            ? formatDateTime(s.sentAt)
            : s.scheduledFor
            ? `Scheduled: ${formatDateTime(s.scheduledFor)}`
            : "—"}
        </span>
      ),
    },
  ];

  return (
    <Card>
      {awaitingCount > 0 && can("campaigns.approve") && (
        <div className="flex items-center justify-between gap-3 bg-amber-500/10 border-b border-amber-500/20 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-amber-600" />
            <span>
              <strong>{awaitingCount}</strong> follow-up email{awaitingCount === 1 ? "" : "s"} due and awaiting your human approval.
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              variant="primary"
              loading={approveAll.isPending}
              onClick={() => approveAll.mutate()}
              icon={<CheckCircle className="h-3.5 w-3.5" />}
            >
              Approve All Due ({awaitingCount})
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <FilterChips
          label="Filter recipients"
          value={filter}
          onChange={(k) => {
            setFilter(k);
            setPage(1);
          }}
          options={options.filter((o) => o.key === "all" || (o.count !== undefined ? o.count > 0 : true))}
        />
        <div className="flex items-center gap-2">
          {can("campaigns.control") && (
            <Button
              size="sm"
              variant="ghost"
              loading={stopAll.isPending}
              onClick={() => {
                if (window.confirm("Stop all scheduled follow-up emails for this campaign?")) {
                  stopAll.mutate();
                }
              }}
              icon={<Square className="h-3.5 w-3.5 text-danger" />}
            >
              Stop All Follow-ups
            </Button>
          )}
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Find an email" className="w-56" />
          <a href={`/api/campaigns/${campaignId}/export`} className={buttonClasses("secondary", "md")} download>
            <Download className="h-4 w-4" /> Export
          </a>
        </div>
      </div>
      {sends.isError ? (
        <ErrorState error={sends.error} onRetry={() => sends.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={sends.data?.data}
            rowKey={(s) => s.id}
            loading={sends.isPending}
            onRowClick={(s) => setOpenId(s.id)}
            caption="Recipients"
            empty={<EmptyState icon={Mail} title="No recipients here" description="Nothing matches this filter." />}
          />
          <Pagination pagination={sends.data?.pagination} onPage={setPage} />
        </>
      )}
      {openId && <SendDrawer campaignId={campaignId} sendId={openId} fromLine={fromLine} onClose={() => setOpenId(null)} />}
    </Card>
  );
}
