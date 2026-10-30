// Researched details for a contact: always with a source; applied only by a person
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { ExternalLink, Plus } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useEnrichment, useInvalidate } from "../../lib/queries";
import { useAuth } from "../../lib/auth";
import { timeAgo } from "../../lib/format";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { Checkbox, SelectField, TextField } from "../ui/Field";
import { Callout } from "../ui/Feedback";
import { useToast } from "../ui/Toast";
import { EnrichmentInputSchema, type EnrichmentDto, type EnrichmentStatus } from "@shared/types";

const STATUS: Record<EnrichmentStatus, { label: string; tone: "neutral" | "success" | "warning" | "danger" | "info" }> = {
  GUESSED: { label: "Unverified", tone: "warning" },
  VERIFIED: { label: "Verified", tone: "success" },
  MANUAL: { label: "Checked at source", tone: "success" },
  REJECTED: { label: "Rejected", tone: "neutral" },
};

const FIELD_OPTIONS = [
  { value: "title", label: "Job title" },
  { value: "company", label: "Company" },
  { value: "phone", label: "Phone" },
  { value: "firstName", label: "First name" },
  { value: "lastName", label: "Last name" },
  { value: "linkedin", label: "LinkedIn (custom field)" },
  { value: "website", label: "Website (custom field)" },
  { value: "city", label: "City (custom field)" },
];

function AddForm({ contactId, onDone }: { contactId: string; onDone: () => void }) {
  const [form, setForm] = useState({ field: "title", value: "", source: "", url: "", note: "", confidence: "0.7", verified: false });
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidate();
  const add = useMutation({
    mutationFn: (body: unknown) => api.post(`/api/enrichment/contact/${contactId}`, body),
    onSuccess: async () => {
      await invalidate("enrichment");
      onDone();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = () => {
    const parsed = EnrichmentInputSchema.safeParse({ ...form, confidence: Number(form.confidence) });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form.");
    setError(null);
    add.mutate(parsed.data);
  };
  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-muted p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField label="Field" value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value })} options={FIELD_OPTIONS} />
        <TextField label="Value" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} />
        <TextField label="Source" value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} placeholder="e.g. Company website" />
        <TextField label="Link to evidence" optional value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })} placeholder="https://" />
        <SelectField
          label="Confidence"
          value={form.confidence}
          onChange={(e) => setForm({ ...form, confidence: e.target.value })}
          options={[
            { value: "0.3", label: "Low — a guess" },
            { value: "0.7", label: "Medium — likely" },
            { value: "0.95", label: "High — stated by the source" },
          ]}
        />
        <TextField label="Note" optional value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} />
      </div>
      <Checkbox checked={form.verified} onChange={(e) => setForm({ ...form, verified: e.target.checked })} label="I checked this myself at the source" />
      {error && <Callout tone="danger">{error}</Callout>}
      <div className="flex justify-end gap-2">
        <Button size="sm" onClick={onDone}>Cancel</Button>
        <Button size="sm" variant="primary" onClick={submit} loading={add.isPending}>Save detail</Button>
      </div>
    </div>
  );
}

function Row({ e }: { e: EnrichmentDto }) {
  const toast = useToast();
  const invalidate = useInvalidate();
  const { can } = useAuth();
  const [confirmOverwrite, setConfirmOverwrite] = useState(false);
  const review = useMutation({
    mutationFn: (decision: "verify" | "reject") => api.post(`/api/enrichment/${e.id}/review`, { decision }),
    onSuccess: () => invalidate("enrichment"),
    onError: (err) => toast.error("Couldn't update", errorMessage(err)),
  });
  const apply = useMutation({
    mutationFn: (overwrite: boolean) => api.post(`/api/enrichment/${e.id}/apply`, { overwrite }),
    onSuccess: async () => {
      await invalidate("enrichment", "contacts");
      toast.success("Applied to contact", `${e.field} updated`);
      setConfirmOverwrite(false);
    },
    onError: (err) => toast.error("Not applied", errorMessage(err)),
  });
  const usable = e.status === "VERIFIED" || e.status === "MANUAL";
  const conflicts = Boolean(e.currentValue && e.currentValue !== e.value);

  return (
    <li className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[13px]">
          <span className="text-ink-subtle">{e.field}:</span> <span className="font-medium">{e.value}</span>
        </p>
        <div className="flex items-center gap-1.5">
          <Badge tone={STATUS[e.status].tone}>{STATUS[e.status].label}</Badge>
          {e.appliedAt && <Badge tone="info">Applied</Badge>}
        </div>
      </div>
      <p className="text-xs text-ink-subtle">
        From {e.source} · {Math.round(e.confidence * 100)}% confidence · {timeAgo(e.createdAt)}
        {e.verifiedBy && ` · verified by ${e.verifiedBy}`}
        {e.url && (
          <>
            {" · "}
            <a href={e.url} target="_blank" rel="noreferrer noopener" className="link inline-flex items-center gap-0.5">
              evidence <ExternalLink className="h-3 w-3" />
            </a>
          </>
        )}
      </p>
      {e.note && <p className="text-xs text-ink-muted">{e.note}</p>}
      {conflicts && !e.appliedAt && <p className="text-xs text-warning">Contact currently has “{e.currentValue}”.</p>}
      {can("contacts.manage") && !e.appliedAt && e.status !== "REJECTED" && (
        <div className="flex flex-wrap gap-2">
          {e.status === "GUESSED" && (
            <>
              <Button size="sm" onClick={() => review.mutate("verify")} loading={review.isPending && review.variables === "verify"}>Mark verified</Button>
              <Button size="sm" variant="ghost" onClick={() => review.mutate("reject")}>Reject</Button>
            </>
          )}
          {usable &&
            (conflicts && confirmOverwrite ? (
              <>
                <Button size="sm" variant="primary" onClick={() => apply.mutate(true)} loading={apply.isPending}>Replace “{e.currentValue}”</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmOverwrite(false)}>Keep current</Button>
              </>
            ) : (
              <Button size="sm" variant={conflicts ? "secondary" : "primary"} onClick={() => (conflicts ? setConfirmOverwrite(true) : apply.mutate(false))} loading={apply.isPending}>
                Apply to contact
              </Button>
            ))}
        </div>
      )}
    </li>
  );
}

export function EnrichmentSection({ contactId }: { contactId: string }) {
  const { can } = useAuth();
  const [adding, setAdding] = useState(false);
  const items = useEnrichment(contactId);
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">Researched details</h3>
        {can("contacts.manage") && !adding && (
          <Button size="sm" variant="ghost" icon={<Plus className="h-3.5 w-3.5" />} onClick={() => setAdding(true)}>Add</Button>
        )}
      </div>
      <p className="mb-3 text-xs text-ink-subtle">Record what you found and where. Nothing changes on the contact until a verified detail is applied.</p>
      {adding && <AddForm contactId={contactId} onDone={() => setAdding(false)} />}
      {items.data && items.data.data.length > 0 ? (
        <ul className="mt-3 space-y-2">{items.data.data.map((e) => <Row key={e.id} e={e} />)}</ul>
      ) : (
        !adding && <p className="text-xs text-ink-faint">No researched details yet.</p>
      )}
    </section>
  );
}
