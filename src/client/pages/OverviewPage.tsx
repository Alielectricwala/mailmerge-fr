import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Circle, FileText, Plus, Send, Upload, type LucideIcon } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useOverview } from "../lib/queries";
import { useTitle } from "../lib/hooks";
import { greeting, num, percent, plural, timeAgo } from "../lib/format";
import { cn } from "../lib/cn";
import { PageHeader } from "../components/ui/Navigation";
import { Card, Panel, Stat } from "../components/ui/Card";
import { ButtonLink } from "../components/ui/Button";
import { Badge, CampaignStatusBadge } from "../components/ui/Badge";
import { ErrorState, ProgressBar } from "../components/ui/Feedback";
import { PageLoader } from "../components/ui/Spinner";
import { CampaignProgress } from "../components/campaigns/CampaignProgress";
import type { CampaignSummaryDto, OverviewDto } from "@shared/types";

function CampaignLine({ c, aside }: { c: CampaignSummaryDto; aside?: React.ReactNode }) {
  return (
    <Link to={`/campaigns/${c.id}`} className="flex items-center gap-4 px-5 py-3.5 transition-colors hover:bg-surface-muted">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-[13px] font-medium text-ink">{c.name}</p>
          <CampaignStatusBadge status={c.status} />
        </div>
        <p className="mt-0.5 truncate text-xs text-ink-subtle">
          {c.template.name} · {c.list.name} ({plural(c.list.memberCount, "contact")})
        </p>
      </div>
      {aside}
    </Link>
  );
}

function GetStarted({ data }: { data: OverviewDto }) {
  const steps: { done: boolean; title: string; text: string; to: string; cta: string; icon: LucideIcon }[] = [
    { done: data.counts.contacts > 0, title: "Import your contacts", text: "Upload a CSV or Excel file into a list.", to: "/contacts/import", cta: "Import contacts", icon: Upload },
    { done: data.counts.templates > 0, title: "Write a template", text: "Personalize with fields like {{firstName}}.", to: "/templates/new", cta: "New template", icon: FileText },
    { done: data.recent.length + data.inProgress.length + data.awaitingApproval.length > 0, title: "Create a campaign", text: "Pick a template and a list, review, then get approval.", to: "/campaigns/new", cta: "New campaign", icon: Send },
  ];
  if (steps.every((s) => s.done)) return null;
  const next = steps.find((s) => !s.done)!;
  return (
    <Panel title="Get started" description="Three steps to your first approved campaign.">
      <ol className="grid gap-4 md:grid-cols-3">
        {steps.map((s, i) => (
          <li key={s.title} className={cn("rounded-lg border p-4", s === next ? "border-brand/40 bg-brand-soft/40" : "border-line")}>
            <div className="flex items-center gap-2">
              {s.done ? <CheckCircle2 className="h-4 w-4 text-success" /> : <Circle className="h-4 w-4 text-ink-faint" />}
              <p className="text-[13px] font-medium">
                {i + 1}. {s.title}
              </p>
            </div>
            <p className="mt-1.5 text-xs leading-5 text-ink-subtle">{s.text}</p>
            {s === next && (
              <ButtonLink to={s.to} variant="primary" size="sm" className="mt-3" icon={<s.icon className="h-3.5 w-3.5" />}>
                {s.cta}
              </ButtonLink>
            )}
          </li>
        ))}
      </ol>
    </Panel>
  );
}

export function OverviewPage() {
  useTitle("Overview");
  const { user, can } = useAuth();
  const overview = useOverview();

  if (overview.isPending) return <PageLoader />;
  if (overview.isError) return <ErrorState error={overview.error} onRetry={() => overview.refetch()} />;
  const data = overview.data.data;
  const firstName = user?.name.split(" ")[0] ?? "";
  const usage = data.mailbox.sentLast24h / data.mailbox.dailyLimit;

  return (
    <>
      <PageHeader
        title={`${greeting()}, ${firstName}`}
        description="Here's where your outreach stands."
        actions={can("campaigns.manage") && <ButtonLink to="/campaigns/new" variant="primary" icon={<Plus className="h-4 w-4" />}>New campaign</ButtonLink>}
      />

      <div className="space-y-6">
        <Card className="flex flex-wrap items-center gap-x-8 gap-y-4 px-5 py-4">
          <div className="flex items-center gap-3">
            <span className="text-[13px] font-medium text-ink">Sending</span>
            {data.mailbox.liveSendingEnabled ? <Badge tone="success" dot>Live</Badge> : <Badge tone="warning" dot>Off</Badge>}
            {!data.mailbox.liveSendingEnabled && <span className="text-xs text-ink-subtle">{data.mailbox.liveSendingBlocker}</span>}
          </div>
          <div className="flex min-w-[220px] flex-1 items-center gap-3">
            <span className="whitespace-nowrap text-[13px] text-ink-muted">Last 24 hours</span>
            <ProgressBar className="max-w-[220px]" segments={[{ value: data.mailbox.sentLast24h, className: usage > 0.9 ? "bg-warning" : "bg-brand", label: "Sent" }, { value: Math.max(0, data.mailbox.dailyLimit - data.mailbox.sentLast24h), className: "bg-transparent", label: "Remaining" }]} />
            <span className="tabular whitespace-nowrap text-xs text-ink-subtle">
              {num(data.mailbox.sentLast24h)} / {num(data.mailbox.dailyLimit)}
            </span>
          </div>
          <Link to="/settings" className="link text-[13px]">
            Mailbox settings
          </Link>
        </Card>

        <GetStarted data={data} />

        <div className="grid gap-6 lg:grid-cols-2">
          <Panel
            title={can("campaigns.approve") ? "Needs your approval" : "Waiting for approval"}
            description={can("campaigns.approve") ? "Review the content and recipients, then approve or send back." : "A founder reviews these before anything sends."}
            flush
          >
            {data.awaitingApproval.length ? (
              <div className="divide-y divide-line">
                {data.awaitingApproval.map((c) => (
                  <CampaignLine key={c.id} c={c} aside={<span className="whitespace-nowrap text-xs text-ink-subtle">{timeAgo(c.updatedAt)}</span>} />
                ))}
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[13px] text-ink-subtle">Nothing waiting.</p>
            )}
          </Panel>

          <Panel title="In progress" description="Approved, sending or paused." flush>
            {data.inProgress.length ? (
              <div className="divide-y divide-line">
                {data.inProgress.map((c) => (
                  <CampaignLine key={c.id} c={c} aside={<CampaignProgress counts={c.counts} compact />} />
                ))}
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[13px] text-ink-subtle">No campaigns are sending.</p>
            )}
          </Panel>
        </div>

        {data.needsAttention.length > 0 && (
          <Panel title="Needs attention" flush>
            <div className="divide-y divide-line">
              {data.needsAttention.map((n) => (
                <Link key={n.campaign.id} to={`/campaigns/${n.campaign.id}?tab=recipients&filter=${n.unknown ? "unknown" : "failed"}`} className="flex items-center gap-3 px-5 py-3.5 hover:bg-surface-muted">
                  <AlertTriangle className="h-4 w-4 shrink-0 text-warning" />
                  <span className="flex-1 text-[13px] font-medium">{n.campaign.name}</span>
                  {n.failed > 0 && <Badge tone="danger">{plural(n.failed, "failed message")}</Badge>}
                  {n.unknown > 0 && <Badge tone="warning">{plural(n.unknown, "message")} to review</Badge>}
                </Link>
              ))}
            </div>
          </Panel>
        )}

        <div className="grid gap-6 lg:grid-cols-3">
          <Panel title="Last 30 days" className="lg:col-span-1">
            <div className="grid grid-cols-2 gap-5">
              <Stat label="Emails sent" value={num(data.last30Days.sent)} />
              <Stat label="Replies" value={num(data.last30Days.replied)} hint={percent(data.last30Days.replied, data.last30Days.sent)} />
              <Stat label="Bounced" value={num(data.last30Days.bounced)} hint={percent(data.last30Days.bounced, data.last30Days.sent)} tone={data.last30Days.bounced / Math.max(1, data.last30Days.sent) > 0.03 ? "warning" : "default"} />
              <Stat label="Unsubscribed" value={num(data.last30Days.unsubscribed)} hint={percent(data.last30Days.unsubscribed, data.last30Days.sent)} />
            </div>
          </Panel>

          <Panel title="Recent campaigns" className="lg:col-span-2" flush actions={<Link to="/campaigns" className="link text-[13px]">View all</Link>}>
            {data.recent.length ? (
              <div className="divide-y divide-line">
                {data.recent.map((c) => (
                  <CampaignLine key={c.id} c={c} aside={<span className="whitespace-nowrap text-xs text-ink-subtle">{timeAgo(c.updatedAt)}</span>} />
                ))}
              </div>
            ) : (
              <p className="px-5 py-8 text-center text-[13px] text-ink-subtle">No drafts or finished campaigns yet.</p>
            )}
          </Panel>
        </div>

        <p className="text-xs text-ink-faint">
          {plural(data.counts.contacts, "contact")} · {plural(data.counts.lists, "list")} · {plural(data.counts.templates, "template")} · {num(data.counts.suppressed)} suppressed
        </p>
      </div>
    </>
  );
}
