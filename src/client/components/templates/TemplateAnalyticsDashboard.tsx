import { useState } from "react";
import { Link } from "react-router-dom";
import {
  BarChart3,
  ChevronDown,
  ChevronUp,
  Filter,
  Info,
  Lightbulb,
  RotateCcw,
} from "lucide-react";
import { useTemplateAnalytics } from "../../lib/queries";
import { num, plural } from "../../lib/format";
import { Card, Panel, Stat } from "../ui/Card";
import { Badge, type Tone } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SelectField } from "../ui/Field";
import { EmptyState, ErrorState } from "../ui/Feedback";
import { PageLoader } from "../ui/Spinner";
import type {
  TemplateAnalyticsQuery,
  TemplatePerformanceItemDto,
  ActionableInsightDto,
} from "@shared/types";

export function TemplateAnalyticsDashboard() {
  const [filters, setFilters] = useState<TemplateAnalyticsQuery>({
    dateRange: "all",
  });
  const [expandedTemplateId, setExpandedTemplateId] = useState<string | null>(null);

  const analytics = useTemplateAnalytics(filters);
  const data = analytics.data?.data;

  const handleFilterChange = (key: keyof TemplateAnalyticsQuery, val: string) => {
    setFilters((prev) => ({
      ...prev,
      [key]: val === "" || val === "all" ? undefined : val,
    }));
  };

  const handleResetFilters = () => {
    setFilters({ dateRange: "all" });
  };

  const hasActiveFilters = Boolean(
    filters.campaignId ||
    filters.hotelSegment ||
    filters.contactPersona ||
    (filters.dateRange && filters.dateRange !== "all")
  );

  if (analytics.isPending) {
    return <PageLoader label="Calculating template attribution & performance metrics…" />;
  }

  if (analytics.isError || !data) {
    return <ErrorState error={analytics.error} onRetry={() => analytics.refetch()} />;
  }

  const { overview, templates, insights, availableFilters } = data;

  return (
    <div className="space-y-6">
      {/* Filters Bar */}
      <Card className="p-4">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2 text-sm font-medium text-ink">
            <Filter className="h-4 w-4 text-ink-muted" />
            <span>Filter Performance Data</span>
            {hasActiveFilters && (
              <Badge tone="info" className="ml-1">Active</Badge>
            )}
          </div>
          {hasActiveFilters && (
            <Button
              size="sm"
              variant="ghost"
              icon={<RotateCcw className="h-3.5 w-3.5" />}
              onClick={handleResetFilters}
            >
              Reset filters
            </Button>
          )}
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <SelectField
            label="Campaign"
            value={filters.campaignId ?? "all"}
            onChange={(e) => handleFilterChange("campaignId", e.target.value)}
            options={[
              { value: "all", label: "All Campaigns" },
              ...availableFilters.campaigns.map((c) => ({ value: c.id, label: c.name })),
            ]}
          />

          <SelectField
            label="Date Range"
            value={filters.dateRange ?? "all"}
            onChange={(e) => handleFilterChange("dateRange", e.target.value)}
            options={[
              { value: "all", label: "All Time" },
              { value: "7d", label: "Last 7 Days" },
              { value: "30d", label: "Last 30 Days" },
              { value: "90d", label: "Last 90 Days" },
            ]}
          />

          <SelectField
            label="Hotel Segment"
            value={filters.hotelSegment ?? "all"}
            onChange={(e) => handleFilterChange("hotelSegment", e.target.value)}
            options={[
              { value: "all", label: "All Hotel Segments" },
              ...availableFilters.segments.map((s) => ({ value: s, label: s.replace(/_/g, " ") })),
            ]}
          />

          <SelectField
            label="Contact Persona"
            value={filters.contactPersona ?? "all"}
            onChange={(e) => handleFilterChange("contactPersona", e.target.value)}
            options={[
              { value: "all", label: "All Contact Personas" },
              ...availableFilters.personas.map((p) => ({ value: p, label: p.replace(/_/g, " ") })),
            ]}
          />
        </div>
      </Card>

      {/* High-level Overview Metrics with Explicit Denominators */}
      <Panel>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="Evaluated"
            value={num(overview.totalTemplatesEvaluated)}
            hint={plural(overview.totalAssigned, "intended recipient")}
          />
          <Stat
            label="Delivered"
            value={num(overview.totalDelivered)}
            hint={`${overview.overallDeliveryRate}% of ${num(overview.totalAttempted)} attempted`}
            tone={overview.overallDeliveryRate >= 95 ? "success" : "default"}
          />
          <Stat
            label="Bounced"
            value={num(overview.totalBounced)}
            hint="Delivery failures"
            tone={overview.totalBounced > 0 ? "warning" : "default"}
          />
          <Stat
            label="Replies"
            value={num(overview.totalReplies)}
            hint={`${overview.overallReplyRate}% reply rate`}
            tone={overview.overallReplyRate >= 10 ? "success" : "default"}
          />
          <Stat
            label="Positive Replies"
            value={num(overview.totalPositiveReplies)}
            hint={overview.totalReplies > 0 ? `${Math.round((overview.totalPositiveReplies / overview.totalReplies) * 100)}% of replies` : "—"}
            tone={overview.totalPositiveReplies > 0 ? "success" : "default"}
          />
          <Stat
            label="Meetings"
            value={num(overview.totalMeetingsBooked)}
            hint={`${overview.overallMeetingRate}% conversion`}
            tone={overview.totalMeetingsBooked > 0 ? "success" : "default"}
          />
        </div>
      </Panel>

      {/* Actionable Insights Section */}
      {insights.length > 0 && (
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Lightbulb className="h-4 w-4 text-brand" />
            <h3 className="text-sm font-semibold text-ink">Actionable Observations & Hypotheses</h3>
          </div>
          <div className="grid gap-3 md:grid-cols-2">
            {insights.map((insight, idx) => (
              <InsightCard key={idx} insight={insight} />
            ))}
          </div>
        </div>
      )}

      {/* Template Comparison Table */}
      <Card>
        <div className="border-b border-line p-4">
          <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-ink">Template Performance Comparison</h2>
              <p className="text-xs text-ink-muted">
                Fair comparison across campaigns. Delivery rate is provider-accepted minus bounces. Reply and meeting rates use verified delivered recipients as the denominator.
              </p>
            </div>
            <div className="text-xs text-ink-subtle">
              {templates.length} template{templates.length === 1 ? "" : "s"} shown
            </div>
          </div>
        </div>

        {templates.length === 0 ? (
          <EmptyState
            icon={BarChart3}
            title="No template performance data"
            description="No sends match the current filters. Adjust your filters or start a campaign to collect performance analytics."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-line bg-surface-sunken/50 text-[11px] font-medium uppercase tracking-wider text-ink-muted">
                <tr>
                  <th className="py-3 pl-4 pr-3">Template</th>
                  <th className="py-3 px-3">Subject</th>
                  <th className="py-3 px-3 text-center">Sample Confidence</th>
                  <th className="py-3 px-3 text-right">Attempted / Delivered</th>
                  <th className="py-3 px-3 text-right">Bounces</th>
                  <th className="py-3 px-3 text-right">Replies (Rate)</th>
                  <th className="py-3 px-3 text-right">Sentiment Breakdown</th>
                  <th className="py-3 px-3 text-right">Meetings (Conv.)</th>
                  <th className="py-3 pl-3 pr-4 text-center">Audience</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {templates.map((t) => {
                  const isExpanded = expandedTemplateId === t.templateId;
                  return (
                    <TemplateRow
                      key={t.templateId}
                      item={t}
                      isExpanded={isExpanded}
                      onToggleExpand={() =>
                        setExpandedTemplateId(isExpanded ? null : t.templateId)
                      }
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

function InsightCard({ insight }: { insight: ActionableInsightDto }) {
  const isObservation = insight.category === "OBSERVATION";
  return (
    <div
      className={`rounded-lg border p-4 transition-colors ${
        isObservation
          ? "border-brand/20 bg-brand-soft/20 text-ink"
          : "border-warning/30 bg-warning-soft/20 text-ink"
      }`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <Badge tone={isObservation ? "brand" : "warning"}>
            {insight.category}
          </Badge>
          <h4 className="font-medium text-ink">{insight.title}</h4>
        </div>
        {insight.metricBadge && (
          <span className="rounded bg-white/80 px-2 py-0.5 text-[11px] font-semibold shadow-xs">
            {insight.metricBadge}
          </span>
        )}
      </div>
      <p className="mt-2 text-xs text-ink-muted leading-relaxed">
        {insight.description}
      </p>
      {insight.recommendation && (
        <div className="mt-2.5 flex items-start gap-1.5 text-xs text-ink">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-brand" />
          <span><strong>Next step:</strong> {insight.recommendation}</span>
        </div>
      )}
    </div>
  );
}

function TemplateRow({
  item,
  isExpanded,
  onToggleExpand,
}: {
  item: TemplatePerformanceItemDto;
  isExpanded: boolean;
  onToggleExpand: () => void;
}) {
  const sampleTone: Tone = item.isLimitedData ? "warning" : "success";

  return (
    <>
      <tr className="hover:bg-surface-sunken/40">
        <td className="py-3 pl-4 pr-3 font-medium text-ink">
          <div className="flex items-center gap-1.5">
            <Link to={`/templates/${item.templateId}`} className="hover:underline font-medium">
              {item.templateName}
            </Link>
            <span className="rounded bg-surface-sunken px-1.5 py-0.5 text-[10px] text-ink-muted font-normal">
              v{item.currentVersion}
            </span>
          </div>
          <div className="text-[11px] text-ink-subtle">
            {plural(item.assignedCount, "assigned")}
          </div>
        </td>

        <td className="py-3 px-3 max-w-[200px] truncate text-ink-muted" title={item.subject}>
          {item.subject}
        </td>

        <td className="py-3 px-3 text-center">
          <Badge tone={sampleTone} dot>
            {item.isLimitedData ? "Limited sample (<20)" : "Reliable sample (≥20)"}
          </Badge>
        </td>

        <td className="py-3 px-3 text-right tabular-nums">
          <span className="font-medium text-ink">{item.deliveredCount}</span>
          <span className="text-ink-subtle"> / {item.attemptedCount}</span>
          <div className="text-[10px] text-ink-muted">{item.deliveryRate}% deliv.</div>
        </td>

        <td className="py-3 px-3 text-right tabular-nums">
          {item.bouncedCount > 0 ? (
            <span className="font-medium text-warning">{item.bouncedCount}</span>
          ) : (
            <span className="text-ink-faint">0</span>
          )}
        </td>

        <td className="py-3 px-3 text-right tabular-nums">
          <span className="font-semibold text-ink">{item.repliedCount}</span>
          <div className="text-[10px] font-medium text-brand">
            {item.deliveredCount > 0 ? `${item.replyRate}%` : "—"}
          </div>
        </td>

        <td className="py-3 px-3 text-right text-[11px] tabular-nums">
          {item.repliedCount > 0 ? (
            <div className="flex items-center justify-end gap-1.5">
              {item.positiveRepliesCount > 0 && (
                <span className="text-success font-medium" title="Positive interest">
                  +{item.positiveRepliesCount}
                </span>
              )}
              {item.negativeRepliesCount > 0 && (
                <span className="text-danger font-medium" title="Opt-out / Uninterested">
                  -{item.negativeRepliesCount}
                </span>
              )}
              {item.outOfOfficeCount > 0 && (
                <span className="text-ink-subtle" title="Out of office">
                  {item.outOfOfficeCount} ooo
                </span>
              )}
              {item.neutralRepliesCount > 0 && (
                <span className="text-ink-muted" title="Neutral / Needs review">
                  {item.neutralRepliesCount} neu
                </span>
              )}
            </div>
          ) : (
            <span className="text-ink-faint">None</span>
          )}
        </td>

        <td className="py-3 px-3 text-right tabular-nums">
          <span className="font-semibold text-ink">{item.meetingsBookedCount}</span>
          <div className="text-[10px] text-ink-muted">
            {item.deliveredCount > 0 ? `${item.meetingRate}%` : "—"}
          </div>
        </td>

        <td className="py-3 pl-3 pr-4 text-center">
          <Button
            size="sm"
            variant="ghost"
            onClick={onToggleExpand}
            icon={isExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
          >
            {isExpanded ? "Hide" : "Breakdown"}
          </Button>
        </td>
      </tr>

      {/* Expanded Segment & Persona Matrix */}
      {isExpanded && (
        <tr className="bg-surface-sunken/30">
          <td colSpan={9} className="p-4 border-b border-line">
            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Performance by Hotel Segment
                </h4>
                {item.bySegment.length === 0 ? (
                  <p className="text-xs text-ink-faint">No segment data recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {item.bySegment.map((seg) => (
                      <div
                        key={seg.segment}
                        className="flex items-center justify-between rounded bg-white p-2 border border-line text-xs"
                      >
                        <span className="font-medium text-ink">
                          {seg.segment.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-4 text-ink-muted tabular-nums">
                          <span>{seg.deliveredCount} deliv.</span>
                          <span className="font-medium text-brand">
                            {seg.repliedCount} replies ({seg.replyRate}%)
                          </span>
                          <span className="text-ink">
                            {seg.meetingsCount} mtgs
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div>
                <h4 className="text-xs font-semibold uppercase tracking-wider text-ink-muted mb-2">
                  Performance by Contact Persona
                </h4>
                {item.byPersona.length === 0 ? (
                  <p className="text-xs text-ink-faint">No persona data recorded yet.</p>
                ) : (
                  <div className="space-y-1.5">
                    {item.byPersona.map((per) => (
                      <div
                        key={per.persona}
                        className="flex items-center justify-between rounded bg-white p-2 border border-line text-xs"
                      >
                        <span className="font-medium text-ink">
                          {per.persona.replace(/_/g, " ")}
                        </span>
                        <div className="flex items-center gap-4 text-ink-muted tabular-nums">
                          <span>{per.deliveredCount} deliv.</span>
                          <span className="font-medium text-brand">
                            {per.repliedCount} replies ({per.replyRate}%)
                          </span>
                          <span className="text-ink">
                            {per.meetingsCount} mtgs
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}
