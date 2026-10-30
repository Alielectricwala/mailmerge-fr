import { useState } from "react";
import {
  Building2,
  CheckCircle2,
  Download,
  Info,
  Sparkles,
  Split,
  Trash2,
  Users,
} from "lucide-react";
import {
  LIST_PREPARATION_GUIDES,
  PROSPECT_LIST_TYPES,
  type ColumnGuideItem,
  type ListTypePreparationGuide,
  type ProspectListType,
} from "@shared/data-prep";
import { Dialog } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";

export function DataPreparationGuideModal({
  open,
  onClose,
  initialListType = "HOTEL_PROSPECTS",
  onSelectType,
}: {
  open: boolean;
  onClose: () => void;
  initialListType?: ProspectListType;
  onSelectType?: (type: ProspectListType) => void;
}) {
  const [activeType, setActiveType] = useState<ProspectListType>(initialListType);
  const guide = LIST_PREPARATION_GUIDES[activeType];

  const downloadSampleCsv = (g: ListTypePreparationGuide) => {
    const blob = new Blob([g.sampleCsv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.setAttribute("download", g.sampleFileName);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const sampleRows = guide.sampleCsv
    .trim()
    .split("\n")
    .map((line: string) => {
      // Basic CSV splitter for sample table preview
      const result: string[] = [];
      let inQuotes = false;
      let cur = "";
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (c === '"') {
          inQuotes = !inQuotes;
        } else if (c === "," && !inQuotes) {
          result.push(cur.trim());
          cur = "";
        } else {
          cur += c;
        }
      }
      result.push(cur.trim());
      return result;
    });

  const headers = sampleRows[0] ?? [];
  const previewRows = sampleRows.slice(1, 4);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Intelligent Data Preparation Guide"
      description="Prepare your spreadsheet before importing to maximize personalization and avoid delivery issues."
      size="lg"
      footer={
        <div className="flex w-full items-center justify-between">
          <Button
            variant="secondary"
            icon={<Download className="h-4 w-4" />}
            onClick={() => downloadSampleCsv(guide)}
          >
            Download {guide.shortLabel} Sample CSV
          </Button>
          <div className="flex items-center gap-2">
            {onSelectType && (
              <Button
                variant="primary"
                onClick={() => {
                  onSelectType(activeType);
                  onClose();
                }}
              >
                Use this guide
              </Button>
            )}
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>
      }
    >
      <div className="space-y-6">
        {/* List Type Switcher */}
        <div className="flex flex-wrap gap-2 rounded-lg border border-line bg-surface-muted/40 p-1.5">
          {PROSPECT_LIST_TYPES.map((type: ProspectListType) => {
            const g = LIST_PREPARATION_GUIDES[type];
            const isSelected = activeType === type;
            return (
              <button
                key={type}
                type="button"
                onClick={() => setActiveType(type)}
                className={`flex flex-1 min-w-[140px] items-center justify-center gap-2 rounded-md px-3 py-2 text-xs font-semibold transition-all ${
                  isSelected
                    ? "bg-surface text-ink shadow-sm border border-line"
                    : "text-ink-muted hover:text-ink hover:bg-surface/50"
                }`}
              >
                {type === "HOTEL_PROSPECTS" && <Building2 className="h-3.5 w-3.5 text-brand" />}
                {type === "CO_MARKETING_PARTNERS" && <Split className="h-3.5 w-3.5 text-info" />}
                {type === "GENERAL_BUSINESS" && <Users className="h-3.5 w-3.5 text-ink-muted" />}
                <span>{g.title}</span>
              </button>
            );
          })}
        </div>

        {/* Overview Banner */}
        <div className="rounded-lg border border-line bg-surface p-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-semibold text-sm text-ink">{guide.title}</span>
                <Badge tone={guide.badgeTone}>{guide.shortLabel}</Badge>
              </div>
              <p className="mt-1 text-xs text-ink-muted">{guide.summary}</p>
            </div>
            <Button
              size="sm"
              variant="secondary"
              icon={<Download className="h-3.5 w-3.5" />}
              onClick={() => downloadSampleCsv(guide)}
            >
              Get Template
            </Button>
          </div>

          <div className="mt-3 flex items-center gap-2 rounded bg-surface-muted/60 px-3 py-2 text-[11px] text-ink-subtle">
            <Sparkles className="h-3.5 w-3.5 text-brand shrink-0" />
            <span>{guide.personalizationTip}</span>
          </div>
        </div>

        {/* Section 1: Essential & Recommended Columns */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Essential */}
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <CheckCircle2 className="h-4 w-4 text-success" />
              <span className="text-xs font-bold uppercase tracking-wider text-ink">
                Essential Columns (Required)
              </span>
            </div>
            <div className="space-y-2.5">
              {guide.essentialColumns.map((col: ColumnGuideItem) => (
                <div key={col.name} className="rounded-md border border-line/60 bg-surface-muted/30 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{col.name}</span>
                    <Badge tone="success">Required</Badge>
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">{col.description}</p>
                  <div className="mt-1.5 flex items-center justify-between text-[11px] text-ink-subtle">
                    <span>e.g. <em className="text-ink">{col.example}</em></span>
                    {col.personalizationTag && (
                      <span className="font-mono text-brand text-[10px] bg-brand-soft/40 px-1 rounded">
                        {col.personalizationTag}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Recommended */}
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-brand" />
              <span className="text-xs font-bold uppercase tracking-wider text-ink">
                Strongly Recommended (Personalization)
              </span>
            </div>
            <div className="space-y-2.5 max-h-[280px] overflow-y-auto pr-1">
              {guide.recommendedColumns.map((col: ColumnGuideItem) => (
                <div key={col.name} className="rounded-md border border-line/60 bg-surface-muted/30 p-2.5 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-ink">{col.name}</span>
                    {col.personalizationTag && (
                      <span className="font-mono text-brand text-[10px] bg-brand-soft/40 px-1 rounded">
                        {col.personalizationTag}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-[11px] text-ink-muted">{col.description}</p>
                  <p className="mt-1 text-[11px] text-ink-subtle">
                    e.g. <em className="text-ink">{col.example}</em>
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section 2: Enrichment Fields & Removable Columns */}
        <div className="grid gap-4 sm:grid-cols-2">
          {/* Useful Enrichment Fields */}
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2 mb-2">
              <Info className="h-4 w-4 text-info" />
              <span className="text-xs font-bold uppercase tracking-wider text-ink">
                Useful Enrichment Fields (Optional)
              </span>
            </div>
            <p className="mb-3 text-[11px] text-ink-subtle">
              Incomplete data is fully supported. You can import contacts now and enrich details later.
            </p>
            <div className="space-y-2 max-h-[200px] overflow-y-auto pr-1">
              {guide.enrichmentColumns.map((col: { name: string; description: string }) => (
                <div key={col.name} className="rounded border border-line/50 p-2 text-xs">
                  <div className="font-medium text-ink">{col.name}</div>
                  <div className="text-[11px] text-ink-muted">{col.description}</div>
                </div>
              ))}
            </div>
          </div>

          {/* Removable Columns */}
          <div className="rounded-lg border border-line bg-surface p-4">
            <div className="flex items-center gap-2 mb-2">
              <Trash2 className="h-4 w-4 text-ink-muted" />
              <span className="text-xs font-bold uppercase tracking-wider text-ink">
                Safe to Remove / Exclude
              </span>
            </div>
            <p className="mb-3 text-[11px] text-ink-subtle">
              These columns add clutter and can be safely mapped to &quot;Ignore&quot; or removed from your sheet.
            </p>
            <div className="space-y-2">
              {guide.removableColumns.map((col: { name: string; reason: string }) => (
                <div key={col.name} className="rounded border border-dashed border-line p-2 text-xs">
                  <div className="font-medium text-ink flex items-center justify-between">
                    <span>{col.name}</span>
                    <span className="text-[10px] text-ink-subtle bg-surface-muted px-1.5 py-0.5 rounded">Ignore</span>
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-subtle">{col.reason}</div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Section 3: Interactive Sample Rows Preview */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-subtle">
              Sample Spreadsheet Structure ({guide.sampleFileName})
            </span>
            <span className="text-xs text-ink-subtle">Preview of first 3 rows</span>
          </div>
          <div className="overflow-x-auto rounded-lg border border-line bg-surface">
            <table className="w-full text-left text-xs">
              <thead>
                <tr className="border-b border-line bg-surface-muted text-ink font-medium">
                  {headers.map((h: string, i: number) => (
                    <th key={i} className="whitespace-nowrap px-3 py-2 text-[11px]">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {previewRows.map((row: string[], rIdx: number) => (
                  <tr key={rIdx} className="hover:bg-surface-muted/20">
                    {row.map((val: string, cIdx: number) => (
                      <td key={cIdx} className="max-w-[200px] truncate px-3 py-2 text-[11px] text-ink-muted">
                        {val}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
