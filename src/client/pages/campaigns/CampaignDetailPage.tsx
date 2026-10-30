import { useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { FlaskConical, Inbox, Pause, Pencil, Play, RefreshCw, RotateCcw, Send, ShieldCheck, Undo2 } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useCampaign, useInvalidate, useMailbox, useReview, type CampaignDetail } from "../../lib/queries";
import { useTitle } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { formatDateTime, num, plural, timeAgo } from "../../lib/format";
import { PageHeader, Tabs, ActionMenu } from "../../components/ui/Navigation";
import { DescriptionList, Panel, Stat } from "../../components/ui/Card";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Badge, CampaignStatusBadge, CAMPAIGN_STATUS } from "../../components/ui/Badge";
import { Callout, ErrorState } from "../../components/ui/Feedback";
import { Checkbox, TextAreaField, TextField } from "../../components/ui/Field";
import { ConfirmDialog, Dialog } from "../../components/ui/Overlay";
import { PageLoader } from "../../components/ui/Spinner";
import { useToast } from "../../components/ui/Toast";
import { CampaignProgress } from "../../components/campaigns/CampaignProgress";
import { ReviewPanel } from "../../components/campaigns/ReviewPanel";
import { RecipientsPanel } from "../../components/campaigns/RecipientsPanel";
import { TemplateRulesPanel } from "../../components/campaigns/TemplateRulesPanel";
import { EmailPreview } from "../../components/email/EmailPreview";
import { EmailSchema, type CampaignReviewDto } from "@shared/types";

type DialogKey = null | "test" | "submit" | "approve" | "return" | "start" | "cancel" | "delete";

function TestSendDialog({ campaign, onClose }: { campaign: CampaignDetail; onClose: () => void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [to, setTo] = useState(user?.email ?? "");
  const [error, setError] = useState<string | null>(null);
  const send = useMutation({
    mutationFn: (addresses: string[]) => api.post<{ results: { to: string; ok: boolean; error?: string }[]; renderedFor: string | null }>(`/api/campaigns/${campaign.id}/test`, { to: addresses }),
    onSuccess: (res) => {
      const failed = res.data.results.filter((r) => !r.ok);
      if (failed.length) setError(failed.map((f) => `${f.to}: ${f.error}`).join(" "));
      else {
        toast.success("Test sent", `Personalized for ${res.data.renderedFor ?? "a sample person"}. Check ${res.data.results.map((r) => r.to).join(", ")}.`);
        onClose();
      }
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = () => {
    const addresses = to.split(/[,\s]+/).filter(Boolean);
    const bad = addresses.find((a) => !EmailSchema.safeParse(a).success);
    if (!addresses.length) return setError("Add at least one address.");
    if (bad) return setError(`"${bad}" isn't a valid email address.`);
    if (addresses.length > 5) return setError("Up to 5 test addresses.");
    setError(null);
    send.mutate(addresses);
  };
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!send.isPending}
      title="Send a test"
      description="Sends one copy, personalized for the first recipient on the list, with “[Test]” in the subject. Recipients aren't emailed."
      footer={
        <>
          <Button onClick={onClose} disabled={send.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={send.isPending} icon={<FlaskConical className="h-4 w-4" />}>Send test</Button>
        </>
      }
    >
      <TextField label="Send to" value={to} onChange={(e) => setTo(e.target.value)} hint="Separate up to 5 addresses with commas." error={error} data-autofocus />
    </Dialog>
  );
}

function ApproveDialog({ campaign, review, onClose, onDone }: { campaign: CampaignDetail; review: CampaignReviewDto; onClose: () => void; onDone: () => void }) {
  const [checked, setChecked] = useState(false);
  const approve = useMutation({
    mutationFn: () => api.post(`/api/campaigns/${campaign.id}/approve`, { contentHash: review.contentHash, ready: review.ready }),
    onSuccess: onDone,
  });
  const skipped = review.total - review.ready;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!approve.isPending}
      title="Approve this campaign?"
      footer={
        <>
          <Button onClick={onClose} disabled={approve.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => approve.mutate()} disabled={!checked} loading={approve.isPending} icon={<ShieldCheck className="h-4 w-4" />}>
            Approve and lock
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[13px] leading-5">
        <ul className="space-y-1.5 text-ink-muted">
          <li>• <strong className="text-ink">{plural(review.ready, "recipient")}</strong> will receive this email{skipped ? `; ${num(skipped)} will be skipped` : ""}.</li>
          <li>• The content and recipients are locked. Later template or list edits won't change this campaign.</li>
          <li>• Nothing sends until someone presses <strong className="text-ink">Start sending</strong>.</li>
        </ul>
        <Checkbox checked={checked} onChange={(e) => setChecked(e.target.checked)} label="I've reviewed the recipients and the personalized preview." />
        {approve.isError && <Callout tone="danger">{errorMessage(approve.error)}</Callout>}
      </div>
    </Dialog>
  );
}

function ReturnDialog({ campaign, onClose, onDone, asFounder }: { campaign: CampaignDetail; onClose: () => void; onDone: () => void; asFounder: boolean }) {
  const [note, setNote] = useState("");
  const action = useMutation({ mutationFn: () => api.post(`/api/campaigns/${campaign.id}/return-to-draft`, { note: note || undefined }), onSuccess: onDone });
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!action.isPending}
      title={asFounder ? "Send back for changes?" : "Withdraw the approval request?"}
      description="The campaign returns to draft so it can be edited, then submitted again."
      footer={
        <>
          <Button onClick={onClose} disabled={action.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => action.mutate()} loading={action.isPending}>{asFounder ? "Send back" : "Withdraw"}</Button>
        </>
      }
    >
      <TextAreaField label={asFounder ? "What should change?" : "Note"} optional value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder={asFounder ? "Shown in the activity log" : ""} />
      {action.isError && <Callout tone="danger" className="mt-3">{errorMessage(action.error)}</Callout>}
    </Dialog>
  );
}

function StatusBanner({ c }: { c: CampaignDetail }) {
  const { can } = useAuth();
  switch (c.status) {
    case "DRAFT":
      return <Callout title="Draft">Check the review below and send yourself a test. When it looks right, submit it for a founder's approval.</Callout>;
    case "PENDING_APPROVAL":
      return can("campaigns.approve") ? (
        <Callout tone="warning" title="Waiting for your approval">
          Submitted by {c.approvalRequestedBy?.name ?? "a teammate"} {timeAgo(c.approvalRequestedAt)}. Review the recipients and preview, then approve or send it back.
        </Callout>
      ) : (
        <Callout tone="warning" title="Waiting for a founder">Submitted {timeAgo(c.approvalRequestedAt)}. You'll see it move to Approved here.</Callout>
      );
    case "APPROVED":
      return c.liveSendingBlocker ? (
        <Callout tone="warning" title="Approved — but sending is off on this server">{c.liveSendingBlocker}</Callout>
      ) : (
        <Callout tone="info" title={`Approved by ${c.approvedBy?.name ?? "a founder"} ${timeAgo(c.approvedAt)}`}>Content and recipients are locked. Start sending when you're ready.</Callout>
      );
    case "SENDING":
      return c.waitingReason ? <Callout tone="warning" title="Waiting">{c.waitingReason}</Callout> : <Callout tone="info" title="Sending">About {c.sendRatePerMinute} emails a minute. You can pause at any time.</Callout>;
    case "PAUSED":
      return <Callout tone="warning" title="Paused">{c.pausedReason ?? "Sending is on hold. Resume to continue where it stopped."}</Callout>;
    case "COMPLETED":
      return c.counts.unknown ? (
        <Callout tone="warning" title="Finished — some messages need review">{plural(c.counts.unknown, "message")} may or may not have been delivered. Open them in Recipients to decide.</Callout>
      ) : (
        <Callout tone="success" title="Completed">Finished {timeAgo(c.completedAt)}. Replies and bounces keep updating here.</Callout>
      );
    case "CANCELLED":
      return <Callout title="Cancelled">Cancelled {timeAgo(c.cancelledAt)}. Messages already sent stay in the log.</Callout>;
  }
}

export function CampaignDetailPage() {
  const { id = "" } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const toast = useToast();
  const invalidate = useInvalidate();
  const { can } = useAuth();
  const campaign = useCampaign(id);
  const c = campaign.data?.data;
  const preApproval = c?.status === "DRAFT" || c?.status === "PENDING_APPROVAL";
  const review = useReview(id, Boolean(preApproval));
  const [dialog, setDialog] = useState<DialogKey>(null);
  useTitle(c?.name ?? "Campaign");

  const tab = (params.get("tab") ?? (preApproval ? "review" : "recipients")) as "review" | "templates" | "recipients" | "content" | "details";
  const setTab = (t: string) => setParams({ tab: t }, { replace: true });

  const refresh = () => invalidate("campaigns", "overview");
  const mailbox = useMailbox();
  const [showUnmatched, setShowUnmatched] = useState(false);
  const syncMailbox = useMutation({
    mutationFn: () => api.post("/api/mailbox/check-inbox"),
    onSuccess: async () => {
      await refresh();
      await mailbox.refetch();
      toast.success("Mailbox synchronized", "Checked for incoming replies and bounces.");
    },
    onError: (err) => toast.error("Mailbox check failed", errorMessage(err)),
  });

  const act = useMutation({
    mutationFn: (path: string) => api.post(`/api/campaigns/${id}/${path}`),
    onSuccess: async (_r, path) => {
      await refresh();
      setDialog(null);
      const messages: Record<string, string> = {
        "request-approval": "Submitted for approval",
        start: "Sending started",
        pause: "Sending paused",
        resume: "Sending resumed",
        cancel: "Campaign cancelled",
        "retry-failed": "Failed messages queued again",
      };
      toast.success(messages[path] ?? "Done");
    },
    onError: (err) => toast.error("That didn't work", errorMessage(err)),
  });
  const duplicate = useMutation({
    mutationFn: () => api.post<{ id: string }>(`/api/campaigns/${id}/duplicate`),
    onSuccess: async (res) => {
      await refresh();
      toast.success("Duplicated as a new draft");
      navigate(`/campaigns/${res.data.id}`);
    },
    onError: (err) => toast.error("Couldn't duplicate", errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/api/campaigns/${id}`),
    onSuccess: async () => {
      await refresh();
      toast.success("Campaign deleted");
      navigate("/campaigns");
    },
  });

  if (campaign.isPending) return <PageLoader />;
  if (campaign.isError || !c) return <ErrorState error={campaign.error} onRetry={() => campaign.refetch()} />;

  const fromLine = `${c.fromName} <${c.fromEmail ?? "mailbox not configured"}>`;
  const r = review.data?.data;
  const canSubmit = Boolean(r && r.ready > 0 && r.templateErrors.length === 0);
  const deliverable = c.counts.total - c.counts.skipped;
  const etaMinutes = Math.ceil(c.counts.pending / c.sendRatePerMinute);

  // Primary actions for the current state
  const primary = (() => {
    const busy = (p: string) => act.isPending && act.variables === p;
    switch (c.status) {
      case "DRAFT":
        return (
          <>
            {can("campaigns.manage") && <ButtonLink to={`/campaigns/${id}/edit`} icon={<Pencil className="h-4 w-4" />}>Edit</ButtonLink>}
            {can("campaigns.send_test") && <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => setDialog("test")}>Send test</Button>}
            {can("campaigns.request_approval") && (
              <Button variant="primary" icon={<Send className="h-4 w-4" />} disabled={!canSubmit} title={canSubmit ? undefined : "Fix the issues in the review first"} onClick={() => setDialog("submit")}>
                Submit for approval
              </Button>
            )}
          </>
        );
      case "PENDING_APPROVAL":
        return can("campaigns.approve") ? (
          <>
            {can("campaigns.send_test") && <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => setDialog("test")}>Send test</Button>}
            <Button icon={<Undo2 className="h-4 w-4" />} onClick={() => setDialog("return")}>Send back</Button>
            <Button variant="primary" icon={<ShieldCheck className="h-4 w-4" />} disabled={!r || review.isFetching} onClick={() => setDialog("approve")}>Approve</Button>
          </>
        ) : (
          <Button icon={<Undo2 className="h-4 w-4" />} onClick={() => setDialog("return")}>Withdraw request</Button>
        );
      case "APPROVED":
        return (
          can("campaigns.control") && (
            <>
              {can("campaigns.send_test") && <Button icon={<FlaskConical className="h-4 w-4" />} onClick={() => setDialog("test")}>Send test</Button>}
              <Button variant="primary" icon={<Play className="h-4 w-4" />} disabled={Boolean(c.liveSendingBlocker)} title={c.liveSendingBlocker ?? undefined} onClick={() => setDialog("start")}>
                Start sending
              </Button>
            </>
          )
        );
      case "SENDING":
        return can("campaigns.control") && <Button icon={<Pause className="h-4 w-4" />} loading={busy("pause")} onClick={() => act.mutate("pause")}>Pause</Button>;
      case "PAUSED":
        return can("campaigns.control") && <Button variant="primary" icon={<Play className="h-4 w-4" />} loading={busy("resume")} disabled={Boolean(c.liveSendingBlocker)} title={c.liveSendingBlocker ?? undefined} onClick={() => act.mutate("resume")}>Resume</Button>;
      case "COMPLETED":
        return can("campaigns.control") && c.counts.failed > 0 && <Button icon={<RotateCcw className="h-4 w-4" />} loading={busy("retry-failed")} onClick={() => act.mutate("retry-failed")}>Retry {plural(c.counts.failed, "failed message")}</Button>;
      default:
        return null;
    }
  })();

  const tabs = [
    ...(preApproval ? [{ key: "review" as const, label: "Review" }] : [{ key: "recipients" as const, label: "Recipients", count: c.counts.total }]),
    { key: "templates" as const, label: "Templates & Rules", count: (c.templates?.length ?? 1) },
    ...(!preApproval ? [{ key: "content" as const, label: "Approved content" }] : []),
    { key: "details" as const, label: "Details" },
  ];

  return (
    <>
      <PageHeader
        back={{ to: "/campaigns", label: "Campaigns" }}
        title={c.name}
        meta={
          <div className="flex items-center gap-2 flex-wrap">
            <CampaignStatusBadge status={c.status} />
            <Badge
              tone={
                c.automationMode === "AUTOMATIC"
                  ? "warning"
                  : c.automationMode === "APPROVAL_REQUIRED"
                  ? "success"
                  : "neutral"
              }
            >
              {c.automationMode === "AUTOMATIC"
                ? "Automatic Follow-ups"
                : c.automationMode === "APPROVAL_REQUIRED"
                ? "Approval Required"
                : "Manual Sending"}
            </Badge>
            {c.sequenceSteps && c.sequenceSteps.length > 1 && (
              <Badge tone="brand">
                {c.sequenceSteps.length} Steps
              </Badge>
            )}
          </div>
        }
        description={c.description ?? `${c.template.name} → ${c.list.name}`}
        actions={
          <>
            {primary}
            <ActionMenu
              items={[
                { label: "Duplicate as new draft", onSelect: () => duplicate.mutate(), hidden: !can("campaigns.manage") },
                { label: "Retry failed messages", onSelect: () => act.mutate("retry-failed"), hidden: !(can("campaigns.control") && c.counts.failed > 0 && ["SENDING", "PAUSED"].includes(c.status)) },
                {
                  label: "Stop all follow-ups",
                  tone: "danger",
                  onSelect: () => {
                    if (window.confirm("Stop all scheduled follow-up emails for this campaign?")) {
                      api.post(`/api/campaigns/${id}/sequence/stop-all`).then(() => {
                        refresh();
                        toast.success("Follow-ups stopped");
                      });
                    }
                  },
                  hidden: !can("campaigns.control") || ["COMPLETED", "CANCELLED", "DRAFT"].includes(c.status),
                },
                { label: "Cancel campaign", tone: "danger", onSelect: () => setDialog("cancel"), hidden: !can("campaigns.control") || ["COMPLETED", "CANCELLED", "DRAFT"].includes(c.status) },
                { label: "Delete", tone: "danger", onSelect: () => setDialog("delete"), hidden: !can("campaigns.manage") || !(c.status === "DRAFT" || (c.status === "CANCELLED" && c.counts.sent === 0)) },
              ]}
            />
          </>
        }
      />

      <div className="space-y-6">
        <StatusBanner c={c} />

        {!preApproval && (
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-sunken/40 px-4 py-2.5 text-xs text-ink-muted">
            <div className="flex items-center gap-2 flex-wrap">
              <Inbox className="h-4 w-4 text-ink-subtle" />
              <span>
                {mailbox.data?.data.imap.configured
                  ? mailbox.data.data.imap.lastCheckedAt
                    ? `Mailbox last synced ${timeAgo(mailbox.data.data.imap.lastCheckedAt)}`
                    : "Mailbox monitoring active"
                  : "Mailbox monitoring (IMAP) not configured"}
              </span>
              {mailbox.data?.data.imap.lastError && (
                <Badge tone="warning">Check warning: {mailbox.data.data.imap.lastError}</Badge>
              )}
              {Boolean(mailbox.data?.data.imap.unmatchedReplies?.length) && (
                <button
                  type="button"
                  onClick={() => setShowUnmatched(true)}
                  className="text-brand hover:underline font-medium ml-2"
                >
                  {mailbox.data!.data.imap.unmatchedReplies!.length} unmatched repl{mailbox.data!.data.imap.unmatchedReplies!.length === 1 ? "y" : "ies"}
                </button>
              )}
            </div>
            <div className="flex items-center gap-2">
              {can("settings.manage") && mailbox.data?.data.imap.configured && (
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RefreshCw className={`h-3.5 w-3.5 ${syncMailbox.isPending ? "animate-spin" : ""}`} />}
                  loading={syncMailbox.isPending}
                  onClick={() => syncMailbox.mutate()}
                >
                  Sync Mailbox
                </Button>
              )}
              <Button
                size="sm"
                variant="ghost"
                onClick={refresh}
              >
                Refresh Stats
              </Button>
            </div>
          </div>
        )}

        {!preApproval && (
          <Panel>
            <div className="grid gap-6 lg:grid-cols-[1fr_auto]">
              <div>
                <CampaignProgress counts={c.counts} />
                {c.status === "SENDING" && c.counts.pending > 0 && <p className="mt-2 text-xs text-ink-subtle">About {etaMinutes} minute{etaMinutes === 1 ? "" : "s"} left at the current pace.</p>}
              </div>
              <div className="grid grid-cols-3 gap-6 sm:grid-cols-6">
                <Stat label="Sent" value={num(c.counts.sent)} hint={`of ${num(deliverable)}`} />
                <Stat label="Queued" value={num(c.counts.pending)} />
                <Stat label="Failed" value={num(c.counts.failed)} tone={c.counts.failed ? "danger" : "default"} />
                <Stat label="Replied" value={num(c.counts.replied)} tone={c.counts.replied ? "success" : "default"} />
                <Stat label="Bounced" value={num(c.counts.bounced)} tone={c.counts.bounced ? "warning" : "default"} />
                <Stat label="Unsubscribed" value={num(c.counts.unsubscribed)} />
              </div>
            </div>
          </Panel>
        )}

        <Tabs tabs={tabs} active={tabs.some((t) => t.key === tab) ? tab : tabs[0]!.key} onChange={setTab} />

        {tab === "review" && preApproval && (
          review.isPending ? <PageLoader label="Checking recipients" /> : review.isError ? <ErrorState error={review.error} onRetry={() => review.refetch()} /> : <ReviewPanel review={review.data.data} fromLine={fromLine} />
        )}

        {tab === "templates" && (
          <TemplateRulesPanel campaign={c} readOnly={c.status !== "DRAFT"} />
        )}

        {tab === "recipients" && !preApproval && <RecipientsPanel campaignId={id} counts={c.counts} live={c.status === "SENDING"} fromLine={fromLine} initialFilter={params.get("filter") ?? undefined} />}

        {tab === "content" && c.snapshot && (
          <Panel title="Approved content" description="The template as it was approved, with merge fields shown as placeholders. Open a recipient to see their personalized copy.">
            <EmailPreview from={fromLine} subject={c.snapshot.subject} html={c.snapshot.bodyHtml} text={c.snapshot.bodyText ?? undefined} />
          </Panel>
        )}

        {tab === "details" && (
          <Panel title="Details">
            <DescriptionList
              items={[
                { label: "Template", value: <Link className="link" to={`/templates/${c.template.id}`}>{c.template.name}</Link> },
                { label: "List", value: <Link className="link" to={`/lists/${c.list.id}`}>{c.list.name} ({plural(c.list.memberCount, "contact")} now)</Link> },
                { label: "Automation Mode", value: c.automationMode === "AUTOMATIC" ? "Automatic Follow-ups" : c.automationMode === "APPROVAL_REQUIRED" ? "Approval Required (Recommended)" : "Manual Sending" },
                { label: "Sequence Cadence", value: `${c.sequenceSteps?.length ?? 1} touch${(c.sequenceSteps?.length ?? 1) === 1 ? "" : "es"} (Day 0 initial${(c.sequenceSteps?.length ?? 1) > 1 ? ` + ${(c.sequenceSteps?.length ?? 1) - 1} follow-up(s)` : ""})` },
                { label: "Safety Stopping Rules", value: "Instant Stop on Inbound Reply • Auto-suppress Bounces • Mailbox Health Guard" },
                { label: "Sends as", value: fromLine },
                { label: "Replies go to", value: c.replyTo ?? c.fromEmail ?? "—" },
                { label: "Pace", value: `${c.sendRatePerMinute} emails per minute` },
                { label: "Status", value: CAMPAIGN_STATUS[c.status].description },
                { label: "Created", value: `${formatDateTime(c.createdAt)}${c.createdBy ? ` by ${c.createdBy.name}` : ""}` },
                { label: "Submitted", value: c.approvalRequestedAt ? `${formatDateTime(c.approvalRequestedAt)}${c.approvalRequestedBy ? ` by ${c.approvalRequestedBy.name}` : ""}` : "—" },
                { label: "Approved", value: c.approvedAt ? `${formatDateTime(c.approvedAt)}${c.approvedBy ? ` by ${c.approvedBy.name}` : ""}` : "—" },
                { label: "Started", value: formatDateTime(c.startedAt) },
                { label: c.status === "CANCELLED" ? "Cancelled" : "Completed", value: formatDateTime(c.status === "CANCELLED" ? c.cancelledAt : c.completedAt) },
              ]}
            />
          </Panel>
        )}
      </div>

      {dialog === "test" && <TestSendDialog campaign={c} onClose={() => setDialog(null)} />}
      {dialog === "approve" && r && (
        <ApproveDialog
          campaign={c}
          review={r}
          onClose={() => setDialog(null)}
          onDone={async () => {
            await refresh();
            setDialog(null);
            setParams({}, { replace: true });
            toast.success("Approved", "Content and recipients are locked.");
          }}
        />
      )}
      {dialog === "return" && (
        <ReturnDialog
          campaign={c}
          asFounder={can("campaigns.approve")}
          onClose={() => setDialog(null)}
          onDone={async () => {
            await refresh();
            setDialog(null);
            toast.success("Returned to draft");
          }}
        />
      )}
      <ConfirmDialog
        open={dialog === "submit"}
        onClose={() => setDialog(null)}
        onConfirm={() => act.mutate("request-approval")}
        loading={act.isPending}
        tone="primary"
        title="Submit for approval?"
        description={r && `A founder will review it before it can send: ${plural(r.ready, "recipient")} ready${r.total - r.ready ? `, ${num(r.total - r.ready)} will be skipped` : ""}.`}
        confirmLabel="Submit"
      />
      <ConfirmDialog
        open={dialog === "start"}
        onClose={() => setDialog(null)}
        onConfirm={() => act.mutate("start")}
        loading={act.isPending}
        tone="primary"
        title={`Start sending to ${plural(c.counts.pending, "recipient")}?`}
        description={`Emails go out from ${c.fromEmail ?? "the mailbox"} at about ${c.sendRatePerMinute} a minute (roughly ${etaMinutes} minute${etaMinutes === 1 ? "" : "s"}). You can pause at any time.`}
        confirmLabel="Start sending"
      />
      <ConfirmDialog
        open={dialog === "cancel"}
        onClose={() => setDialog(null)}
        onConfirm={() => act.mutate("cancel")}
        loading={act.isPending}
        title="Cancel this campaign?"
        description={c.counts.pending ? `${plural(c.counts.pending, "unsent message")} will be cancelled. Messages already sent can't be recalled. This can't be undone.` : "The campaign will be closed. This can't be undone."}
        confirmLabel="Cancel campaign"
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title="Delete this campaign?"
        description={remove.isError ? errorMessage(remove.error) : "The draft and its settings are removed. Templates and contacts stay."}
        confirmLabel="Delete"
      />

      {showUnmatched && (
        <Dialog
          open
          onClose={() => setShowUnmatched(false)}
          title="Unmatched Inbox Replies"
          description="These replies were retrieved from SpaceMail but could not be attributed to a specific recipient or campaign by Message-ID or email address."
          footer={<Button variant="primary" onClick={() => setShowUnmatched(false)}>Close</Button>}
        >
          <div className="space-y-3 max-h-[60vh] overflow-y-auto pr-1">
            {mailbox.data?.data.imap.unmatchedReplies?.map((r, i) => (
              <div key={i} className="rounded-lg border border-line p-3 text-xs space-y-1 bg-surface-sunken/30">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold text-ink truncate">{r.from}</span>
                  <Badge tone={r.detectedSentiment === "POSITIVE" ? "success" : r.detectedSentiment === "NEGATIVE" ? "danger" : "neutral"}>
                    {r.detectedSentiment}
                  </Badge>
                </div>
                <p className="font-medium text-ink-muted truncate">{r.subject}</p>
                <p className="text-ink-muted leading-relaxed italic line-clamp-2">"{r.snippet}"</p>
                <p className="text-[10px] text-ink-subtle">{formatDateTime(r.date)}</p>
              </div>
            ))}
          </div>
        </Dialog>
      )}
    </>
  );
}
