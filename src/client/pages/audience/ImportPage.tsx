// Import wizard: upload → match columns → check emails → destination & duplicates → done
import { useRef, useState, type DragEvent } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  Download,
  Eye,
  FileSpreadsheet,
  HelpCircle,
  Info,
  Mail,
  RotateCcw,
  ShieldCheck,
  Sparkles,
  Split,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useImports, useInvalidate, useLists } from "../../lib/queries";
import { useTitle } from "../../lib/hooks";
import { num, plural, timeAgo } from "../../lib/format";
import { cn } from "../../lib/cn";
import { PageHeader } from "../../components/ui/Navigation";
import { Panel, Stat } from "../../components/ui/Card";
import { Button, ButtonLink } from "../../components/ui/Button";
import { Badge } from "../../components/ui/Badge";
import { ChoiceCard, SelectField, TextField } from "../../components/ui/Field";
import { Callout } from "../../components/ui/Feedback";
import {
  ALL_SHEETS,
  COALESCABLE_TARGETS,
  DUPLICATE_POLICY_LABELS,
  IMPORT_TARGET_LABELS,
  MAX_IMPORT_BYTES,
  PROSPECT_LIST_TYPES,
  toFieldName,
  type DuplicatePolicy,
  type ImportAnalysisDto,
  type ImportPreviewDto,
  type ImportProblemRow,
  type ImportResultDto,
  type ImportRowError,
  type MultiEmailPolicy,
  type ProspectListType,
  type StandardContactField,
} from "@shared/types";
import {
  LIST_PREPARATION_GUIDES,
} from "@shared/data-prep";
import { DataPreparationGuideModal } from "../../components/audience/DataPreparationGuideModal";

type Step = "upload" | "map" | "review" | "destination" | "done";
const STEPS: { key: Step; label: string }[] = [
  { key: "upload", label: "Upload" },
  { key: "map", label: "Match columns" },
  { key: "review", label: "Check emails" },
  { key: "destination", label: "List & duplicates" },
  { key: "done", label: "Done" },
];

const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const rowLabel = (e: Pick<ImportRowError, "sheet" | "row">) =>
  e.sheet ? `${e.sheet} · row ${e.row}` : `Row ${e.row}`;

function Stepper({ step }: { step: Step }) {
  const index = STEPS.findIndex((s) => s.key === step);
  return (
    <ol className="mb-6 flex flex-wrap items-center gap-2 text-[13px]">
      {STEPS.map((s, i) => (
        <li key={s.key} className="flex items-center gap-2">
          <span
            className={cn(
              "flex h-6 w-6 items-center justify-center rounded-full text-xs font-semibold",
              i < index
                ? "bg-success text-white"
                : i === index
                ? "bg-brand text-white"
                : "bg-surface-sunken text-ink-subtle"
            )}
          >
            {i < index ? "✓" : i + 1}
          </span>
          <span className={cn(i === index ? "font-medium text-ink" : "text-ink-subtle")}>
            {s.label}
          </span>
          {i < STEPS.length - 1 && <span className="mx-1 h-px w-8 bg-line" aria-hidden="true" />}
        </li>
      ))}
    </ol>
  );
}

function RecentImports() {
  const imports = useImports();
  const rows = imports.data?.data ?? [];
  if (!rows.length) return null;
  return (
    <Panel title="Recent imports" flush>
      <ul className="divide-y divide-line">
        {rows.slice(0, 6).map((b) => (
          <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-3 text-[13px]">
            <div className="min-w-0">
              <p className="truncate font-medium">{b.fileName}</p>
              <p className="text-xs text-ink-subtle">
                {timeAgo(b.createdAt)}
                {b.createdBy && ` by ${b.createdBy.name}`}
                {b.list && (
                  <>
                    {" "}into{" "}
                    <Link to={`/lists/${b.list.id}`} className="link">
                      {b.list.name}
                    </Link>
                  </>
                )}
              </p>
            </div>
            <p className="tabular text-xs text-ink-muted">
              {num(b.created)} new · {num(b.updated)} updated · {num(b.skipped)} skipped
            </p>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

/** Rows whose email cell couldn't be read */
function ProblemRows({
  rows,
  drafts,
  setDraft,
}: {
  rows: ImportProblemRow[];
  drafts: Record<string, string>;
  setDraft: (ref: string, value: string | undefined) => void;
}) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px]">
        <thead>
          <tr className="border-b border-line bg-surface-muted text-left text-xs font-medium text-ink-subtle">
            <th className="py-2.5 pl-5 pr-4">Where</th>
            <th className="py-2.5 pr-4">In the file</th>
            <th className="w-[340px] py-2.5 pr-5">Correct email</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((p) => {
            const draft = drafts[p.ref];
            const skipped = draft === "";
            const kept = p.kind === "typo" && draft === p.found;
            const invalid = !!draft && !EMAIL_SHAPE.test(draft.trim());
            return (
              <tr
                key={p.ref}
                className={cn("border-b border-line align-top last:border-0", skipped && "bg-surface-muted/60")}
              >
                <td className="whitespace-nowrap py-3 pl-5 pr-4 text-ink-subtle">
                  <span className="tabular">{rowLabel(p)}</span>
                  {p.context && <p className="mt-0.5 max-w-[180px] truncate text-xs text-ink-muted">{p.context}</p>}
                </td>
                <td className="max-w-[280px] py-3 pr-4">
                  <code className="break-all rounded bg-surface-sunken px-1.5 py-0.5 text-xs">
                    {p.raw || "(empty)"}
                  </code>
                  <p className="mt-1 text-xs text-ink-subtle">{p.message}</p>
                </td>
                <td className="py-2.5 pr-5">
                  {skipped || kept ? (
                    <div className="flex h-9 items-center justify-between gap-2">
                      <span className="text-ink-subtle">{skipped ? "Won't be imported" : `Keep ${p.found}`}</span>
                      <Button size="sm" variant="ghost" onClick={() => setDraft(p.ref, undefined)}>
                        Undo
                      </Button>
                    </div>
                  ) : (
                    <div className="space-y-1.5">
                      <div className="flex gap-2">
                        <TextField
                          aria-label={`Correct email for ${rowLabel(p)}`}
                          placeholder="name@company.com"
                          value={draft ?? ""}
                          error={invalid ? "That doesn't look like an email address" : null}
                          onChange={(e) => setDraft(p.ref, e.target.value || undefined)}
                          containerClassName="flex-1"
                        />
                        <Button size="sm" variant="ghost" className="h-9" onClick={() => setDraft(p.ref, "")}>
                          Skip
                        </Button>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
                        {p.suggestion && draft !== p.suggestion && (
                          <button type="button" className="link" onClick={() => setDraft(p.ref, p.suggestion!)}>
                            Use {p.suggestion}?
                          </button>
                        )}
                        {p.kind === "typo" && p.found && (
                          <button
                            type="button"
                            className="link text-ink-subtle"
                            onClick={() => setDraft(p.ref, p.found!)}
                          >
                            Keep as written
                          </button>
                        )}
                      </div>
                    </div>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function ImportPage() {
  useTitle("Import contacts");
  const [params] = useSearchParams();
  const invalidate = useInvalidate();
  const lists = useLists();
  const inputRef = useRef<HTMLInputElement>(null);

  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ImportPreviewDto | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [multiEmail, setMultiEmail] = useState<MultiEmailPolicy>("each");
  const [fixes, setFixes] = useState<Record<string, string>>({});
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [analysis, setAnalysis] = useState<ImportAnalysisDto | null>(null);
  const [policy, setPolicy] = useState<DuplicatePolicy>("fill_empty");
  const [listChoice, setListChoice] = useState<string>(params.get("list") ?? "new");
  const [newListName, setNewListName] = useState("");
  const [result, setResult] = useState<ImportResultDto | null>(null);
  const [dragging, setDragging] = useState(false);

  // Intelligent Data Prep Guide Modal state
  const [prepModalOpen, setPrepModalOpen] = useState(false);
  const [selectedListType, setSelectedListType] = useState<ProspectListType>("HOTEL_PROSPECTS");

  const downloadSample = (type: ProspectListType) => {
    const g = LIST_PREPARATION_GUIDES[type];
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

  const previewMutation = useMutation({
    mutationFn: ({ file: f, sheet }: { file: File; sheet?: string }) => {
      const form = new FormData();
      form.append("file", f);
      if (sheet) form.append("sheet", sheet);
      return api.upload<ImportPreviewDto>("/api/contacts/import/preview", form);
    },
    onSuccess: (res, { file: f }) => {
      if (f !== file) {
        setFixes({});
        setDrafts({});
        if (!newListName) {
          setNewListName(
            f.name.replace(/\.(csv|xlsx|txt)$/i, "").replace(/[_-]+/g, " ").trim().slice(0, 100)
          );
        }
      }
      setFile(f);
      setPreview(res.data);
      setMapping(res.data.suggestedMapping);
      if (res.data.suggestedListType) {
        setSelectedListType(res.data.suggestedListType);
      }
      setAnalysis(null);
      setStep("map");
    },
  });

  const options = (next: { multiEmail?: MultiEmailPolicy; fixes?: Record<string, string> } = {}) => ({
    mapping,
    sheet: preview?.sheet,
    multiEmail: next.multiEmail ?? multiEmail,
    fixes: next.fixes ?? fixes,
  });

  const analyzeMutation = useMutation({
    mutationFn: (opts: ReturnType<typeof options>) => {
      const form = new FormData();
      form.append("file", file!);
      form.append("config", JSON.stringify(opts));
      return api.upload<ImportAnalysisDto>("/api/contacts/import/analyze", form);
    },
    onSuccess: (res, opts) => {
      setAnalysis(res.data);
      setMultiEmail(opts.multiEmail);
      setFixes(opts.fixes);
      const open = new Set(res.data.problems.map((p) => p.ref));
      setDrafts((d) => Object.fromEntries(Object.entries(d).filter(([ref]) => open.has(ref))));
      setStep("review");
    },
  });

  const importMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append("file", file!);
      form.append(
        "config",
        JSON.stringify({
          ...options(),
          duplicatePolicy: policy,
          ...(listChoice === "new" ? { newListName } : { listId: listChoice }),
        })
      );
      return api.upload<ImportResultDto>("/api/contacts/import", form);
    },
    onSuccess: async (res) => {
      setResult(res.data);
      setStep("done");
      await invalidate("contacts", "lists", "overview");
    },
  });

  const [fileError, setFileError] = useState<string | null>(null);
  const pick = (f: File | undefined) => {
    if (!f) return;
    if (f.size > MAX_IMPORT_BYTES) {
      setFileError(
        `${f.name} is ${(f.size / 1024 / 1024).toFixed(1)} MB. The limit is 4 MB, so split it into smaller files.`
      );
      return;
    }
    setFileError(null);
    previewMutation.mutate({ file: f });
  };
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDragging(false);
    pick(e.dataTransfer.files[0]);
  };

  const emailColumn = Object.entries(mapping).find(([, t]) => t === "email")?.[0];
  const companyColumns = Object.entries(mapping).filter(([, t]) => t === "company").map(([h]) => h);
  const nameColumns = Object.entries(mapping).filter(([, t]) => t === "fullName" || t === "firstName").map(([h]) => h);
  const phoneColumns = Object.entries(mapping).filter(([, t]) => t === "phone").map(([h]) => h);
  const websiteColumns = Object.entries(mapping).filter(
    ([h, t]) => t.includes("website") || t.includes("url") || /website|verification|source/i.test(h)
  ).map(([h]) => h);

  const duplicateTargets = Object.values(mapping).filter(
    (t, i, all) => t !== "ignore" && !COALESCABLE_TARGETS.has(t) && all.indexOf(t) !== i
  );

  const coalescedTargets = Array.from(
    new Set(
      Object.values(mapping).filter(
        (t, i, all) => t !== "ignore" && COALESCABLE_TARGETS.has(t) && all.indexOf(t) !== i
      )
    )
  );

  const targetOptions = (header: string) => {
    const current = mapping[header] ?? "ignore";
    const custom = current.startsWith("custom:")
      ? current
      : `custom:${
          preview?.suggestedMapping[header]?.startsWith("custom:")
            ? preview.suggestedMapping[header]!.slice(7)
            : toFieldName(header)
        }`;
    return [
      ...Object.entries(IMPORT_TARGET_LABELS).map(([value, label]) => ({ value, label })),
      { value: custom, label: `Custom field: ${custom.slice(7)}` },
      { value: "ignore", label: "Don't import (Exclude)" },
    ];
  };

  // Quick Column Exclude/Include Helper
  const toggleColumnExclude = (header: string) => {
    if (mapping[header] === "ignore") {
      const suggested = preview?.suggestedMapping[header] ?? `custom:${toFieldName(header)}`;
      setMapping((m) => ({ ...m, [header]: suggested }));
    } else {
      setMapping((m) => ({ ...m, [header]: "ignore" }));
    }
  };

  const excludedColumns = Object.entries(mapping).filter(([, t]) => t === "ignore").map(([h]) => h);

  const setDraft = (ref: string, value: string | undefined) =>
    setDrafts((d) => {
      const next = { ...d };
      if (value === undefined) delete next[ref];
      else next[ref] = value;
      return next;
    });

  const pendingDrafts = Object.entries(drafts).filter(
    ([, v]) => v === "" || EMAIL_SHAPE.test(v.trim())
  );
  const invalidDrafts = Object.values(drafts).some(
    (v) => v !== "" && !EMAIL_SHAPE.test(v.trim())
  );
  const applyDrafts = () =>
    analyzeMutation.mutate(
      options({
        fixes: {
          ...fixes,
          ...Object.fromEntries(pendingDrafts.map(([ref, v]) => [ref, v.trim()])),
        },
      })
    );
  const invalidRows = analysis?.problems.filter((p) => p.kind === "invalid") ?? [];
  const typoRows = analysis?.problems.filter((p) => p.kind === "typo") ?? [];
  const skipRemaining = () =>
    setDrafts((d) => ({
      ...d,
      ...Object.fromEntries(
        invalidRows.filter((p) => d[p.ref] === undefined).map((p) => [p.ref, ""])
      ),
    }));
  const applyButton = (
    <Button
      size="sm"
      variant="primary"
      disabled={!pendingDrafts.length || invalidDrafts}
      loading={analyzeMutation.isPending}
      onClick={applyDrafts}
    >
      Apply {pendingDrafts.length ? plural(pendingDrafts.length, "change") : "changes"}
    </Button>
  );
  const appliedFixes = Object.values(fixes).filter(Boolean).length;
  const appliedSkips = Object.values(fixes).filter((v) => v === "").length;

  const restart = () => {
    setStep("upload");
    setFile(null);
    setPreview(null);
    setAnalysis(null);
    setResult(null);
    setFixes({});
    setDrafts({});
    setMultiEmail("each");
    previewMutation.reset();
    analyzeMutation.reset();
    importMutation.reset();
  };

  const multiSheet = (preview?.sheets.length ?? 0) > 1;
  const sheetOptions = preview
    ? [
        ...preview.sheets.map((s) => ({
          value: s.name,
          label: `${s.name} (${plural(s.rowCount, "row")})`,
        })),
        {
          value: ALL_SHEETS,
          label: `All sheets combined (${plural(
            preview.sheets.reduce((n, s) => n + s.rowCount, 0),
            "row"
          )})`,
        },
      ]
    : [];

  const quality = preview?.qualityBreakdown;

  return (
    <>
      <PageHeader
        back={{ to: "/contacts", label: "Contacts" }}
        title="Import contacts"
        description="CSV or Excel (.xlsx, any number of sheets), up to 4 MB and 50,000 rows."
        actions={
          <Button
            variant="secondary"
            icon={<HelpCircle className="h-4 w-4" />}
            onClick={() => setPrepModalOpen(true)}
          >
            Data Preparation Guide
          </Button>
        }
      />
      <Stepper step={step} />

      {step === "upload" && (
        <div className="space-y-6">
          {/* Preparation Guides Quick Bar */}
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div>
                <span className="font-semibold text-sm text-ink flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-brand" />
                  Intelligent Data Preparation
                </span>
                <p className="text-xs text-ink-muted mt-0.5">
                  Prepare your list with the recommended columns or download a clean starter template.
                </p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                icon={<Eye className="h-3.5 w-3.5" />}
                onClick={() => setPrepModalOpen(true)}
              >
                View Column Requirements
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {PROSPECT_LIST_TYPES.map((type) => {
                const g = LIST_PREPARATION_GUIDES[type];
                return (
                  <div
                    key={type}
                    className="flex flex-col justify-between rounded-lg border border-line bg-surface-muted/30 p-3 text-xs"
                  >
                    <div>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold text-ink">{g.shortLabel}</span>
                        <Badge tone={g.badgeTone}>{g.title.split(" ")[0]}</Badge>
                      </div>
                      <p className="mt-1 text-[11px] text-ink-subtle line-clamp-2">{g.summary}</p>
                    </div>
                    <div className="mt-3 flex items-center justify-between border-t border-line/60 pt-2">
                      <button
                        type="button"
                        className="link text-[11px] font-medium"
                        onClick={() => {
                          setSelectedListType(type);
                          setPrepModalOpen(true);
                        }}
                      >
                        Guide details →
                      </button>
                      <button
                        type="button"
                        className="text-brand hover:underline text-[11px] font-medium flex items-center gap-1"
                        onClick={() => downloadSample(type)}
                      >
                        <Download className="h-3 w-3" /> Sample CSV
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cn(
              "flex flex-col items-center rounded-xl border-2 border-dashed bg-surface px-6 py-14 text-center transition-colors",
              dragging ? "border-brand bg-brand-soft/40" : "border-line-strong"
            )}
          >
            <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-brand-soft text-brand">
              <FileSpreadsheet className="h-6 w-6" />
            </div>
            <p className="text-[15px] font-semibold">Drop a spreadsheet here</p>
            <p className="mt-1 max-w-md text-[13px] text-ink-subtle">
              The first row should contain column names. Cells with several addresses are split automatically,
              and stray text is cleaned.
            </p>
            <Button
              variant="primary"
              className="mt-5"
              icon={<Upload className="h-4 w-4" />}
              loading={previewMutation.isPending}
              onClick={() => inputRef.current?.click()}
            >
              Choose file
            </Button>
            <input
              ref={inputRef}
              type="file"
              accept=".csv,.xlsx,.txt,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              className="hidden"
              onChange={(e) => pick(e.target.files?.[0])}
            />
          </div>
          {(fileError || previewMutation.isError) && (
            <Callout tone="danger" title="That file couldn't be used">
              {fileError ?? errorMessage(previewMutation.error)}
            </Callout>
          )}
          <RecentImports />
        </div>
      )}

      {step === "map" && preview && (
        <div className="space-y-6">
          {/* List Type & Personalization Readiness Banner */}
          <div className="rounded-xl border border-line bg-surface p-4">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand-soft text-brand">
                  {selectedListType === "HOTEL_PROSPECTS" && <Building2 className="h-5 w-5" />}
                  {selectedListType === "CO_MARKETING_PARTNERS" && <Split className="h-5 w-5" />}
                  {selectedListType === "GENERAL_BUSINESS" && <Users className="h-5 w-5" />}
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-sm text-ink">
                      List Type: {LIST_PREPARATION_GUIDES[selectedListType].title}
                    </span>
                    {preview.suggestedListType === selectedListType && (
                      <Badge tone="info">Auto-detected</Badge>
                    )}
                  </div>
                  <p className="text-xs text-ink-muted">
                    {LIST_PREPARATION_GUIDES[selectedListType].summary}
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <SelectField
                  aria-label="Change List Type"
                  value={selectedListType}
                  onChange={(e) => setSelectedListType(e.target.value as ProspectListType)}
                  options={PROSPECT_LIST_TYPES.map((t) => ({
                    value: t,
                    label: LIST_PREPARATION_GUIDES[t].title,
                  }))}
                  containerClassName="w-48"
                />
                <Button
                  size="sm"
                  variant="secondary"
                  icon={<HelpCircle className="h-3.5 w-3.5" />}
                  onClick={() => setPrepModalOpen(true)}
                >
                  Guide
                </Button>
              </div>
            </div>

            {/* Quality & Personalization Readiness Stats */}
            {quality && (
              <div className="mt-4 border-t border-line/60 pt-3 flex flex-wrap items-center justify-between gap-3 text-xs">
                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1.5 font-medium text-ink">
                    <span>Personalization Readiness:</span>
                    <Badge tone={quality.score >= 80 ? "success" : quality.score >= 50 ? "info" : "warning"}>
                      {quality.score}% Score
                    </Badge>
                  </div>
                  {quality.personalizationTagsReady.length > 0 && (
                    <div className="hidden sm:flex items-center gap-1 text-ink-subtle">
                      <span>Ready tags:</span>
                      {quality.personalizationTagsReady.slice(0, 4).map((tag) => (
                        <span key={tag} className="font-mono text-[10px] bg-surface-muted px-1 rounded text-ink">
                          {`{{${tag}}}`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                {quality.essentialMissing.length > 0 ? (
                  <span className="text-warning text-xs font-medium">
                    Missing essential: {quality.essentialMissing.join(", ")}
                  </span>
                ) : (
                  <span className="text-success text-xs flex items-center gap-1">
                    <CheckCircle2 className="h-3.5 w-3.5" /> All essential fields mapped
                  </span>
                )}
              </div>
            )}
          </div>

          {multiSheet && (
            <Panel
              title="Which sheet?"
              description={`${preview.fileName} has ${preview.sheets.length} sheets with data. Combining matches columns by their header name.`}
            >
              <SelectField
                aria-label="Sheet to import"
                containerClassName="max-w-md"
                value={preview.sheet}
                disabled={previewMutation.isPending}
                onChange={(e) => previewMutation.mutate({ file: file!, sheet: e.target.value })}
                options={sheetOptions}
              />
              {previewMutation.isError && (
                <Callout tone="danger" className="mt-3">
                  {errorMessage(previewMutation.error)}
                </Callout>
              )}
            </Panel>
          )}

          {/* Import Field Readiness & Queue Cards */}
          <div className="grid gap-3 sm:grid-cols-3">
            {/* Card 1: Required for Delivery */}
            <div
              className={cn(
                "flex flex-col justify-between rounded-xl border p-4 text-xs transition-colors",
                emailColumn ? "border-line bg-surface" : "border-amber-400 bg-amber-50/40"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    <Mail className="h-4 w-4 text-brand" />
                    <span>1. Required for Delivery</span>
                  </div>
                  <Badge tone={emailColumn ? "success" : "danger"}>
                    {emailColumn ? "Mapped" : "Action Required"}
                  </Badge>
                </div>
                <div className="mt-2.5">
                  {emailColumn ? (
                    <p className="font-medium text-ink flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success inline shrink-0" />
                      <span>
                        Email Column: <strong className="text-ink">{emailColumn}</strong>
                      </span>
                    </p>
                  ) : (
                    <p className="font-medium text-danger flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-danger inline shrink-0" />
                      <span>No email column selected</span>
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-ink-subtle leading-relaxed">
                    Outreach cannot dispatch without an email address. Select which column holds recipient email (e.g. Public Email).
                  </p>
                </div>
              </div>
            </div>

            {/* Card 2: Essential for Personalization */}
            <div
              className={cn(
                "flex flex-col justify-between rounded-xl border p-4 text-xs transition-colors",
                companyColumns.length > 0 ? "border-line bg-surface" : "border-amber-400 bg-amber-50/40"
              )}
            >
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    <Building2 className="h-4 w-4 text-brand" />
                    <span>2. Essential for Personalization</span>
                  </div>
                  <Badge tone={companyColumns.length > 0 ? "success" : "warning"}>
                    {companyColumns.length > 0 ? "Mapped" : "Recommended"}
                  </Badge>
                </div>
                <div className="mt-2.5">
                  {companyColumns.length > 0 ? (
                    <p className="font-medium text-ink flex items-center gap-1.5">
                      <CheckCircle2 className="h-3.5 w-3.5 text-success inline shrink-0" />
                      <span className="truncate">
                        Hotel/Company: <strong className="text-ink">{companyColumns.join(", ")}</strong>
                      </span>
                    </p>
                  ) : (
                    <p className="font-medium text-warning flex items-center gap-1.5">
                      <AlertTriangle className="h-3.5 w-3.5 text-warning inline shrink-0" />
                      <span>Hotel / Company unmapped</span>
                    </p>
                  )}
                  {nameColumns.length > 0 ? (
                    <p className="mt-1 text-ink-subtle">
                      Recipient Name: <strong className="text-ink">{nameColumns.join(", ")}</strong>
                    </p>
                  ) : (
                    <p className="mt-1 text-ink-muted">
                      Recipient Name: Unmapped (fallback greeting will be used)
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-ink-subtle leading-relaxed">
                    Details without which emails break personalization. Essential for <code className="bg-surface-muted px-1 rounded text-[10px]">{"{{company}}"}</code> merge tags.
                  </p>
                </div>
              </div>
            </div>

            {/* Card 3: Optional Research & Enrichment */}
            <div className="flex flex-col justify-between rounded-xl border border-line bg-surface p-4 text-xs">
              <div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 font-semibold text-ink">
                    <Info className="h-4 w-4 text-brand" />
                    <span>3. Optional Research Link</span>
                  </div>
                  <Badge tone="neutral">Optional Context</Badge>
                </div>
                <div className="mt-2.5">
                  <p className="font-medium text-ink flex items-center gap-1.5">
                    <ShieldCheck className="h-3.5 w-3.5 text-brand inline shrink-0" />
                    <span>Website & Phone: Not required for sending</span>
                  </p>
                  <p className="mt-1 text-ink-subtle">
                    {websiteColumns.length > 0
                      ? `Website/Source: ${websiteColumns.join(", ")} (stored as custom tag)`
                      : "Website/Source link: None mapped (omitting will not break outreach)"}
                  </p>
                  {phoneColumns.length > 0 && (
                    <p className="mt-0.5 text-ink-subtle">
                      Phone: {phoneColumns.join(", ")} (optional multichannel field)
                    </p>
                  )}
                  <p className="mt-1.5 text-[11px] text-ink-subtle leading-relaxed">
                    Website links and phones enrich contact profiles, but emails will NOT break without them. They can be safely stored or excluded.
                  </p>
                </div>
              </div>
            </div>
          </div>

          <Panel
            title="Match columns to contact fields"
            description={`${preview.fileName}${
              multiSheet ? ` · ${preview.sheet === ALL_SHEETS ? "all sheets" : preview.sheet}` : ""
            } · ${plural(
              preview.totalRows,
              "row"
            )}. Excluded columns will not be imported. Custom columns remain available for email tags.`}
            flush
          >
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-line bg-surface-muted text-left text-xs font-medium text-ink-subtle">
                    <th className="py-2.5 pl-5 pr-4">Column in file</th>
                    <th className="py-2.5 pr-4">Sample values</th>
                    <th className="w-72 py-2.5 pr-4">Import as</th>
                    <th className="w-24 py-2.5 pr-5 text-right">Exclude</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.headers.map((h, i) => {
                    const isIgnored = mapping[h] === "ignore";
                    return (
                      <tr
                        key={h}
                        className={cn(
                          "border-b border-line last:border-0 transition-colors",
                          isIgnored && "bg-surface-muted/40 opacity-70"
                        )}
                      >
                        <td className="py-3 pl-5 pr-4 font-medium">
                          <span className={cn(isIgnored && "line-through text-ink-subtle")}>{h}</span>
                          {mapping[h] === "email" ? (
                            <Badge tone="brand" className="ml-2 text-[10px]">
                              Email (Required)
                            </Badge>
                          ) : mapping[h] === "company" ? (
                            <Badge tone="info" className="ml-2 text-[10px]">
                              Company / Hotel
                            </Badge>
                          ) : mapping[h] === "phone" ? (
                            <Badge tone="neutral" className="ml-2 text-[10px]">
                              Phone (Optional)
                            </Badge>
                          ) : /website|url|verification|source/i.test(h) ? (
                            <Badge tone="neutral" className="ml-2 text-[10px]">
                              Link (Optional)
                            </Badge>
                          ) : null}
                        </td>
                        <td className="max-w-[320px] py-3 pr-4 text-xs text-ink-subtle">
                          <span className="line-clamp-2">
                            {preview.sampleRows
                              .map((r) => r[i])
                              .filter(Boolean)
                              .slice(0, 3)
                              .join(" · ") || "—"}
                          </span>
                        </td>
                        <td className="py-2.5 pr-4">
                          <SelectField
                            aria-label={`Import ${h} as`}
                            value={mapping[h] ?? "ignore"}
                            onChange={(e) => setMapping({ ...mapping, [h]: e.target.value })}
                            options={targetOptions(h)}
                          />
                        </td>
                        <td className="py-2.5 pr-5 text-right">
                          <Button
                            size="sm"
                            variant="ghost"
                            className={cn(isIgnored ? "text-brand" : "text-ink-subtle hover:text-danger")}
                            onClick={() => toggleColumnExclude(h)}
                            title={isIgnored ? "Include this column" : "Exclude this column"}
                          >
                            {isIgnored ? "Restore" : <Trash2 className="h-3.5 w-3.5" />}
                          </Button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            {excludedColumns.length > 0 && (
              <div className="bg-surface-muted/30 border-t border-line px-5 py-2.5 text-xs text-ink-subtle flex items-center justify-between">
                <span>
                  <strong>{excludedColumns.length}</strong> column{excludedColumns.length === 1 ? "" : "s"} excluded:{" "}
                  <em className="text-ink">{excludedColumns.join(", ")}</em>
                </span>
                <button
                  type="button"
                  className="link text-xs"
                  onClick={() => {
                    const restored: Record<string, string> = { ...mapping };
                    for (const col of excludedColumns) {
                      restored[col] = preview.suggestedMapping[col] ?? `custom:${toFieldName(col)}`;
                    }
                    setMapping(restored);
                  }}
                >
                  Restore all
                </button>
              </div>
            )}

            <div className="space-y-3 border-t border-line px-5 py-4">
              {!emailColumn && (
                <Callout tone="warning">
                  Choose which column holds the recipient email address (e.g. Public Email or Contact Email) to proceed.
                </Callout>
              )}
              {coalescedTargets.length > 0 && (
                <Callout tone="info">
                  Automatic Combining Active: Multiple columns are mapped to{" "}
                  <strong>
                    {coalescedTargets
                      .map((t) => IMPORT_TARGET_LABELS[t as StandardContactField] ?? t)
                      .join(", ")}
                  </strong>{" "}
                  ({companyColumns.join(", ")}). They will automatically combine per row using the first available value without duplicate errors.
                </Callout>
              )}
              {duplicateTargets.length > 0 && (
                <Callout tone="warning">
                  Two columns are going to the same custom field ({duplicateTargets.map((t) => t.replace("custom:", "")).join(", ")}). Pick a different destination for one of them.
                </Callout>
              )}
              {analyzeMutation.isError && (
                <Callout tone="danger" title="Couldn't check the emails">
                  {errorMessage(analyzeMutation.error)}
                </Callout>
              )}
              <div className="flex justify-between">
                <Button onClick={restart}>Choose another file</Button>
                <Button
                  variant="primary"
                  loading={analyzeMutation.isPending}
                  disabled={!emailColumn || duplicateTargets.length > 0 || previewMutation.isPending}
                  onClick={() => analyzeMutation.mutate(options())}
                >
                  Check emails
                </Button>
              </div>
            </div>
          </Panel>
        </div>
      )}

      {step === "review" && preview && analysis && (
        <div className="space-y-6">
          <Panel>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-5">
              <Stat
                label="Contacts to import"
                value={num(analysis.contacts)}
                tone="success"
                hint={`from ${plural(analysis.totalRows, "row")}`}
              />
              <Stat label="Cells with several addresses" value={num(analysis.multiEmailRows)} />
              <Stat label="Cells cleaned" value={num(analysis.cleanedRows)} hint="extra text removed" />
              <Stat label="Repeated in file" value={num(analysis.duplicatesInFile)} hint="imported once" />
              <Stat
                label="Need attention"
                value={num(analysis.problemCount)}
                tone={analysis.problemCount ? "warning" : "default"}
                hint={
                  analysis.typoCount ? `+ ${plural(analysis.typoCount, "possible typo")}` : undefined
                }
              />
            </div>
            {(appliedFixes > 0 || appliedSkips > 0) && (
              <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 text-[13px] text-ink-subtle">
                {appliedFixes > 0 && <Badge tone="success">{plural(appliedFixes, "correction")} applied</Badge>}
                {appliedSkips > 0 && <Badge tone="neutral">{plural(appliedSkips, "row")} skipped</Badge>}
                <Button
                  size="sm"
                  variant="ghost"
                  icon={<RotateCcw className="h-3.5 w-3.5" />}
                  loading={analyzeMutation.isPending}
                  onClick={() => analyzeMutation.mutate(options({ fixes: {} }))}
                >
                  Undo all corrections
                </Button>
              </div>
            )}
          </Panel>

          {(analysis.multiEmailRows > 0 || multiEmail === "first") && (
            <Panel
              title="Cells with more than one address"
              description={`${plural(analysis.multiEmailRows, "row")} list several addresses, e.g. “sales@… ; gm@…”.`}
            >
              <div className="grid gap-3 sm:grid-cols-2">
                <ChoiceCard
                  name="multiEmail"
                  value="each"
                  checked={multiEmail === "each"}
                  onSelect={() => analyzeMutation.mutate(options({ multiEmail: "each" }))}
                  title="One contact per address (recommended)"
                  description="Each address becomes its own contact with the same name, company and other details."
                />
                <ChoiceCard
                  name="multiEmail"
                  value="first"
                  checked={multiEmail === "first"}
                  onSelect={() => analyzeMutation.mutate(options({ multiEmail: "first" }))}
                  title="Only the first address"
                  description="The other addresses in the cell are left out."
                />
              </div>
            </Panel>
          )}

          {analysis.problemCount > 0 ? (
            <Panel
              title="Emails that couldn't be read"
              description={`Type the right address, accept a suggestion, or skip the row. Nothing is changed unless you confirm it.${
                analysis.problemCount > invalidRows.length ? ` Showing the first ${num(invalidRows.length)}.` : ""
              }`}
              flush
            >
              <ProblemRows rows={invalidRows} drafts={drafts} setDraft={setDraft} />
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-4">
                <Button size="sm" variant="ghost" onClick={skipRemaining}>
                  Skip all remaining
                </Button>
                {applyButton}
              </div>
            </Panel>
          ) : (
            <Callout tone="success" title="Every row has a usable email address">
              {analysis.typoCount
                ? "Have a quick look at the possible typos below."
                : "You're ready to choose a list."}
            </Callout>
          )}

          {typoRows.length > 0 && (
            <Panel
              title={`Possible typos (${num(analysis.typoCount)})`}
              description="These addresses look valid but the provider seems misspelt. They're imported as written unless you correct them."
              flush
            >
              <ProblemRows rows={typoRows} drafts={drafts} setDraft={setDraft} />
              <div className="flex justify-end border-t border-line px-5 py-4">{applyButton}</div>
            </Panel>
          )}

          {analyzeMutation.isError && (
            <Callout tone="danger" title="Couldn't check the emails">
              {errorMessage(analyzeMutation.error)}
            </Callout>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button onClick={() => setStep("map")} disabled={analyzeMutation.isPending}>
              Back
            </Button>
            <div className="flex items-center gap-3">
              {analysis.problemCount > 0 && (
                <span className="text-[13px] text-ink-subtle">
                  {plural(analysis.problemCount, "row")} without a usable email will be left out.
                </span>
              )}
              <Button
                variant="primary"
                disabled={!analysis.contacts || pendingDrafts.length > 0 || analyzeMutation.isPending}
                onClick={() => setStep("destination")}
              >
                Continue
              </Button>
            </div>
          </div>
          {pendingDrafts.length > 0 && (
            <p className="text-right text-xs text-ink-subtle">Apply or clear your changes before continuing.</p>
          )}
        </div>
      )}

      {step === "destination" && preview && analysis && (
        <div className="max-w-3xl space-y-6">
          <Panel
            title="Add these contacts to a list"
            description="Campaigns send to lists, so every import goes into one."
          >
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField
                label="List"
                value={listChoice}
                onChange={(e) => setListChoice(e.target.value)}
                options={[
                  { value: "new", label: "Create a new list" },
                  ...(lists.data?.data ?? []).map((l) => ({
                    value: l.id,
                    label: `${l.name} (${num(l.memberCount)})`,
                  })),
                ]}
              />
              {listChoice === "new" && (
                <TextField
                  label="New list name"
                  value={newListName}
                  onChange={(e) => setNewListName(e.target.value)}
                />
              )}
            </div>
          </Panel>

          <Panel title="When a contact already exists" description="Matched by email address.">
            <div className="grid gap-3">
              {(Object.keys(DUPLICATE_POLICY_LABELS) as DuplicatePolicy[]).map((p) => (
                <ChoiceCard
                  key={p}
                  name="policy"
                  value={p}
                  checked={policy === p}
                  onSelect={() => setPolicy(p)}
                  title={DUPLICATE_POLICY_LABELS[p].label + (p === "fill_empty" ? " (recommended)" : "")}
                  description={DUPLICATE_POLICY_LABELS[p].description}
                />
              ))}
            </div>
          </Panel>

          {importMutation.isError && (
            <Callout tone="danger" title="Import didn't run">
              {errorMessage(importMutation.error)}
            </Callout>
          )}
          <div className="flex justify-between">
            <Button onClick={() => setStep("review")} disabled={importMutation.isPending}>
              Back
            </Button>
            <Button
              variant="primary"
              loading={importMutation.isPending}
              disabled={listChoice === "new" && !newListName.trim()}
              onClick={() => importMutation.mutate()}
            >
              Import {plural(analysis.contacts, "contact")}
            </Button>
          </div>
        </div>
      )}

      {step === "done" && result && (
        <div className="max-w-3xl space-y-6">
          <Panel>
            <div className="mb-5 flex items-center gap-3">
              <CheckCircle2 className="h-6 w-6 text-success" />
              <div>
                <p className="text-[15px] font-semibold">Import finished</p>
                <p className="text-[13px] text-ink-subtle">
                  {result.fileName}
                  {result.list && (
                    <>
                      {" "}→{" "}
                      <Link to={`/lists/${result.list.id}`} className="link">
                        {result.list.name}
                      </Link>{" "}
                      ({plural(result.addedToList, "contact")} added)
                    </>
                  )}
                </p>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-5 sm:grid-cols-4">
              <Stat label="New contacts" value={num(result.created)} tone="success" />
              <Stat label="Updated" value={num(result.updated)} />
              <Stat label="Already up to date" value={num(result.unchanged)} />
              <Stat label="Skipped rows" value={num(result.skipped)} tone={result.skipped ? "warning" : "default"} />
            </div>
          </Panel>
          {result.suppressedInFile > 0 && (
            <Callout
              tone="info"
              title={`${plural(result.suppressedInFile, "address")} in the file ${
                result.suppressedInFile === 1 ? "is" : "are"
              } on the suppression list`}
            >
              They were imported but campaigns will skip them.
            </Callout>
          )}
          {result.errors.length > 0 && (
            <Panel
              title="Rows that weren't imported"
              description={result.errors.length >= 200 ? "Showing the first 200." : undefined}
              flush
            >
              <ul className="max-h-80 divide-y divide-line overflow-y-auto">
                {result.errors.map((e) => (
                  <li key={`${e.sheet ?? ""}-${e.row}-${e.message}`} className="flex gap-4 px-5 py-2 text-[13px]">
                    <span className="tabular w-32 shrink-0 text-ink-subtle">{rowLabel(e)}</span>
                    <span className="min-w-0 break-words">{e.message}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
          <div className="flex gap-2">
            {result.list && (
              <ButtonLink to={`/lists/${result.list.id}`} variant="primary">
                Open the list
              </ButtonLink>
            )}
            <ButtonLink to="/campaigns/new">Create a campaign</ButtonLink>
            <Button variant="ghost" onClick={restart}>
              Import another file
            </Button>
          </div>
        </div>
      )}

      {/* Preparation Guide Modal */}
      <DataPreparationGuideModal
        open={prepModalOpen}
        onClose={() => setPrepModalOpen(false)}
        initialListType={selectedListType}
        onSelectType={(t) => setSelectedListType(t)}
      />
    </>
  );
}
