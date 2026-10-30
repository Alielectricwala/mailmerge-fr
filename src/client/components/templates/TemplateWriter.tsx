// "Write it for me": draft a template with Gemini from a brief, or pick a built-in starter.
// Either way the result lands in the editor for a person to review; nothing is saved here.
import { useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { RefreshCw, Sparkles, Wand2 } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useAuth } from "../../lib/auth";
import { useWriterContext } from "../../lib/queries";
import { Drawer } from "../ui/Overlay";
import { Button } from "../ui/Button";
import { Badge } from "../ui/Badge";
import { Checkbox, ChoiceCard, SelectField, TextAreaField, TextField } from "../ui/Field";
import { Callout } from "../ui/Feedback";
import { FilterChips } from "../ui/Navigation";
import { Skeleton } from "../ui/Spinner";
import {
  STARTER_GOALS,
  WRITER_LENGTHS,
  WRITER_TONES,
  buildStarterTemplate,
  reviewTemplateDraft,
  type StarterGoal,
  type TemplateDraftDto,
  type TemplateDraftRequest,
  type WriterLength,
  type WriterTone,
} from "@shared/template-writer";

const BRIEF_IDEAS = [
  "Reach out to hotel leadership about Mise Hotel service execution platform and advisory board pilot",
  "Propose co-marketing partnership between FocusRealm and hospitality training or recruitment platforms",
  "Ask general managers for a 20-minute introductory meeting on SOP task verification",
];

const toneOptions = Object.entries(WRITER_TONES).map(([value, label]) => ({ value, label }));

/** Body text with merge fields highlighted */
function MergeText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\{\{[^{}]*\}\})/g).map((part, i) =>
        i % 2 === 1 ? (
          <span key={i} className="rounded bg-brand-soft px-0.5 font-medium text-brand-ink">
            {part}
          </span>
        ) : (
          part
        )
      )}
    </>
  );
}

function DraftPreview({ draft }: { draft: TemplateDraftDto }) {
  return (
    <div className="animate-fade-in overflow-hidden rounded-lg border border-line">
      <div className="border-b border-line bg-surface-muted px-4 py-2.5">
        <p className="text-2xs font-semibold uppercase tracking-wider text-ink-faint">Subject</p>
        <p className="mt-0.5 text-[14px] font-medium"><MergeText text={draft.subject} /></p>
      </div>
      <div className="max-h-[340px] overflow-y-auto whitespace-pre-wrap px-4 py-3.5 text-[13px] leading-6 text-ink">
        <MergeText text={draft.body} />
      </div>
      {draft.warnings.length > 0 && (
        <div className="border-t border-line bg-warning-soft/50 px-4 py-3">
          <p className="mb-1 text-xs font-semibold text-warning">Check before using</p>
          <ul className="list-disc space-y-0.5 pl-4 text-xs text-ink-muted">
            {draft.warnings.map((w) => (
              <li key={w}>{w}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export function TemplateWriter({
  open,
  onClose,
  currentDraft,
  onUse,
}: {
  open: boolean;
  onClose: () => void;
  /** The editor's plain-text draft, offered as an example */
  currentDraft: { subject: string; body: string } | null;
  onUse: (draft: TemplateDraftDto) => void;
}) {
  const { user } = useAuth();
  const context = useWriterContext(open);
  const aiEnabled = context.data?.data.aiEnabled ?? false;
  const fields = context.data?.data.fields ?? [];
  const totalContacts = context.data?.data.totalContacts ?? 0;

  const [tab, setTab] = useState<"ai" | "starter" | null>(null);
  const activeTab = tab ?? (context.isSuccess && !aiEnabled ? "starter" : "ai");

  const [brief, setBrief] = useState("");
  const [tone, setTone] = useState<WriterTone>("warm");
  const [length, setLength] = useState<WriterLength>("medium");
  const [learnFromDraft, setLearnFromDraft] = useState(false);
  const [example, setExample] = useState("");
  const [signOff, setSignOff] = useState(user?.name ?? "");
  const [goal, setGoal] = useState<StarterGoal>("mise_pilot");

  const hasDraft = Boolean(currentDraft && currentDraft.body.replace(/\{\{[^}]*\}\}|Hi|Best|[\s,]/g, "").length > 40);

  const draft = useMutation({
    mutationFn: () => {
      const examples = [learnFromDraft && currentDraft ? `Subject: ${currentDraft.subject}\n\n${currentDraft.body}` : "", example.trim()].filter(Boolean);
      const body: TemplateDraftRequest = { brief, tone, length, signOff: signOff.trim() || undefined, example: examples.join("\n\n---\n\n") || undefined };
      return api.post<TemplateDraftDto>("/api/templates/ai/draft", body);
    },
  });

  const starter = useMemo(() => {
    const t = buildStarterTemplate({ goal, tone, fields, signOff });
    return { ...t, warnings: reviewTemplateDraft(t, fields, totalContacts) };
  }, [goal, tone, fields, signOff, totalContacts]);

  const result = activeTab === "ai" ? (draft.data?.data ?? null) : starter;
  const briefTooShort = brief.trim().length < 10;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      width="lg"
      title="Write it for me"
      subtitle="Describe the email. You'll review the draft in the editor before anything is saved."
      footer={
        <div className="flex w-full flex-wrap items-center justify-between gap-2">
          <Button variant="ghost" onClick={onClose}>Close</Button>
          <div className="flex gap-2">
            {activeTab === "ai" && aiEnabled && (
              <Button
                variant={result ? "secondary" : "primary"}
                icon={result ? <RefreshCw className="h-4 w-4" /> : <Sparkles className="h-4 w-4" />}
                loading={draft.isPending}
                disabled={briefTooShort}
                onClick={() => draft.mutate()}
              >
                {result ? "Try again" : "Write draft"}
              </Button>
            )}
            {result && (
              <Button variant="primary" disabled={draft.isPending} onClick={() => onUse(result)}>
                Use this draft
              </Button>
            )}
          </div>
        </div>
      }
    >
      <div className="space-y-5">
        <FilterChips
          label="How to write it"
          value={activeTab}
          onChange={setTab}
          options={[
            { key: "ai", label: "Write with AI" },
            { key: "starter", label: "Starter templates" },
          ]}
        />

        {context.isPending && <Skeleton className="h-40 w-full" />}
        {context.isError && <Callout tone="danger">{errorMessage(context.error)}</Callout>}

        {context.isSuccess && activeTab === "ai" && !aiEnabled && (
          <Callout
            tone="info"
            title="AI writing isn't switched on"
            action={<Button size="sm" onClick={() => setTab("starter")}>Use a starter</Button>}
          >
            A founder can turn it on by adding a Google Gemini API key (GEMINI_API_KEY) to the server settings. Starter templates work without it.
          </Callout>
        )}

        {context.isSuccess && activeTab === "ai" && aiEnabled && (
          <>
            <div>
              <TextAreaField
                label="What should this email do?"
                hint="Who it's for, what you offer, and what you'd like them to do. Plain words are fine."
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                rows={4}
                maxLength={2000}
                placeholder="e.g. Introduce our revenue-management service to boutique hotels in Goa and ask for a 15-minute call next week."
              />
              {!brief && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {BRIEF_IDEAS.map((idea) => (
                    <button key={idea} type="button" onClick={() => setBrief(idea)} className="rounded-full border border-line bg-surface-muted px-2.5 py-1 text-xs text-ink-muted hover:border-brand hover:bg-brand-soft hover:text-brand-ink">
                      {idea}
                    </button>
                  ))}
                </div>
              )}
            </div>
            <div className="grid gap-4 sm:grid-cols-3">
              <SelectField label="Tone" value={tone} onChange={(e) => setTone(e.target.value as WriterTone)} options={toneOptions} />
              <SelectField
                label="Length"
                hint={WRITER_LENGTHS[length].words}
                value={length}
                onChange={(e) => setLength(e.target.value as WriterLength)}
                options={Object.entries(WRITER_LENGTHS).map(([value, l]) => ({ value, label: l.label }))}
              />
              <TextField label="Sign off as" optional value={signOff} onChange={(e) => setSignOff(e.target.value)} placeholder="Your name" maxLength={200} />
            </div>
            <div className="space-y-3 rounded-lg border border-line bg-surface-muted/60 p-4">
              <p className="text-[13px] font-medium">Show it an example <span className="font-normal text-ink-subtle">(optional)</span></p>
              {hasDraft && <Checkbox label="Learn from my current draft" description="Keeps your structure and voice, and improves the wording." checked={learnFromDraft} onChange={(e) => setLearnFromDraft(e.target.checked)} />}
              <TextAreaField aria-label="Example email" value={example} onChange={(e) => setExample(e.target.value)} rows={3} maxLength={6000} placeholder="Paste an email you liked, even a rough one." />
            </div>
            <p className="text-xs text-ink-subtle">
              Sent to Google Gemini: your brief, the example and the names of your contact fields
              {totalContacts ? ` (with how many of your ${totalContacts.toLocaleString()} contacts have each)` : ""}. Contact details never leave FocusRealm.
            </p>
            {draft.isError && <Callout tone="danger" title="No draft this time">{errorMessage(draft.error)}</Callout>}
            {draft.isPending && (
              <div className="space-y-2 rounded-lg border border-line p-4" role="status" aria-label="Writing draft">
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-full" />
                <Skeleton className="h-3 w-11/12" />
                <Skeleton className="h-3 w-4/5" />
              </div>
            )}
            {!draft.isPending && result && (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <Badge tone="brand"><Wand2 className="mr-1 inline h-3 w-3" />Draft</Badge>
                  {draft.data?.data.model && <span className="text-xs text-ink-faint">{draft.data.data.model}</span>}
                </div>
                <DraftPreview draft={result} />
              </div>
            )}
          </>
        )}

        {context.isSuccess && activeTab === "starter" && (
          <>
            <div className="grid gap-2.5 sm:grid-cols-2">
              {(Object.keys(STARTER_GOALS) as StarterGoal[]).map((g) => (
                <ChoiceCard key={g} name="starterGoal" value={g} checked={goal === g} onSelect={() => setGoal(g)} title={STARTER_GOALS[g].label} description={STARTER_GOALS[g].description} />
              ))}
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <SelectField label="Tone" value={tone} onChange={(e) => setTone(e.target.value as WriterTone)} options={toneOptions} />
              <TextField label="Sign off as" optional value={signOff} onChange={(e) => setSignOff(e.target.value)} placeholder="Your name" maxLength={200} />
            </div>
            <p className="text-xs text-ink-subtle">
              Built from the fields your contacts have{fields.some((f) => f.custom && f.coverage > 0) ? ", including your custom ones" : ""}. Edit the wording to make it yours.
            </p>
            <DraftPreview draft={starter} />
          </>
        )}
      </div>
    </Drawer>
  );
}
