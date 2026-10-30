import type { CampaignCounts } from "@shared/types";
import { ProgressBar } from "../ui/Feedback";
import { num } from "../../lib/format";

/** Delivery progress of an approved campaign: sent / failed / needs review / skipped / queued */
export function CampaignProgress({ counts, compact = false }: { counts: CampaignCounts; compact?: boolean }) {
  const deliverable = counts.total - counts.skipped;
  if (counts.total === 0) return <span className="text-xs text-ink-subtle">Not approved yet</span>;
  return (
    <div className={compact ? "w-40" : "w-full"}>
      <ProgressBar
        segments={[
          { value: counts.sent, className: "bg-success", label: "Sent" },
          { value: counts.failed, className: "bg-danger", label: "Failed" },
          { value: counts.unknown, className: "bg-warning", label: "Needs review" },
          { value: counts.cancelled, className: "bg-ink-faint", label: "Cancelled" },
          { value: counts.pending, className: "bg-surface-sunken", label: "Queued" },
        ]}
      />
      <p className="tabular mt-1.5 text-xs text-ink-subtle">
        {num(counts.sent)} of {num(deliverable)} sent
        {counts.failed > 0 && <span className="text-danger"> · {num(counts.failed)} failed</span>}
        {counts.unknown > 0 && <span className="text-warning"> · {num(counts.unknown)} to review</span>}
      </p>
    </div>
  );
}
