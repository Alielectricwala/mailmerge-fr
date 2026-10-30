import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Ban, Plus, Trash2 } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useInvalidate, useSuppressions } from "../../lib/queries";
import { useDebounced, useTitle } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { formatDate, plural } from "../../lib/format";
import { PageHeader } from "../../components/ui/Navigation";
import { Card } from "../../components/ui/Card";
import { Badge } from "../../components/ui/Badge";
import { Button, IconButton } from "../../components/ui/Button";
import { SearchInput, SelectField, TextField } from "../../components/ui/Field";
import { DataTable, Pagination, type Column } from "../../components/ui/DataTable";
import { Callout, EmptyState, ErrorState } from "../../components/ui/Feedback";
import { ConfirmDialog, Dialog } from "../../components/ui/Overlay";
import { useToast } from "../../components/ui/Toast";
import { SUPPRESSION_REASON_LABELS, SuppressionInputSchema, type SuppressionDto, type SuppressionReason } from "@shared/types";

const REASON_TONE: Partial<Record<SuppressionReason, "danger" | "warning" | "neutral" | "info">> = {
  HARD_BOUNCE: "danger",
  SPAM_COMPLAINT: "danger",
  UNSUBSCRIBE: "info",
  INVALID_EMAIL: "warning",
};

function AddDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [email, setEmail] = useState("");
  const [reason, setReason] = useState("MANUAL");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const invalidate = useInvalidate();
  const toast = useToast();
  const add = useMutation({
    mutationFn: (body: unknown) => api.post("/api/suppressions", body),
    onSuccess: async () => {
      await invalidate("suppressions", "contacts", "overview");
      toast.success("Address suppressed", email);
      setEmail("");
      setNote("");
      onClose();
    },
    onError: (err) => setError(errorMessage(err)),
  });
  const submit = () => {
    const parsed = SuppressionInputSchema.safeParse({ email, reason, note });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the form.");
    setError(null);
    add.mutate(parsed.data);
  };
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!add.isPending}
      title="Suppress an address"
      description="Campaigns will never email it, including campaigns already approved."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={add.isPending}>Suppress</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} data-autofocus />
        <SelectField
          label="Reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          options={[
            { value: "MANUAL", label: "Asked not to be contacted / other" },
            { value: "UNSUBSCRIBE", label: "Unsubscribed by email or phone" },
            { value: "SPAM_COMPLAINT", label: "Complained" },
            { value: "INVALID_EMAIL", label: "Address doesn't work" },
          ]}
        />
        <TextField label="Note" optional value={note} onChange={(e) => setNote(e.target.value)} />
        {error && <Callout tone="danger">{error}</Callout>}
      </div>
    </Dialog>
  );
}

export function SuppressionsPage() {
  useTitle("Suppressions");
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [search, setSearch] = useState("");
  const [reason, setReason] = useState("");
  const [page, setPage] = useState(1);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<SuppressionDto | null>(null);
  const list = useSuppressions({ page, search: useDebounced(search), reason: reason || undefined });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/api/suppressions/${id}`),
    onSuccess: async () => {
      await invalidate("suppressions", "contacts", "overview");
      toast.success("Removed from suppression list", removing?.email);
      setRemoving(null);
    },
    onError: (err) => toast.error("Couldn't remove", errorMessage(err)),
  });

  const columns: Column<SuppressionDto>[] = [
    { key: "email", header: "Address", cell: (s) => <span className="font-medium">{s.email}</span> },
    { key: "reason", header: "Reason", cell: (s) => <Badge tone={REASON_TONE[s.reason] ?? "neutral"}>{SUPPRESSION_REASON_LABELS[s.reason]}</Badge> },
    { key: "source", header: "Source", cell: (s) => <span className="text-xs text-ink-subtle">{s.note ?? s.source.replace(/^manual:/, "Added by ")}</span> },
    { key: "date", header: "Since", cell: (s) => <span className="whitespace-nowrap text-ink-muted">{formatDate(s.createdAt)}</span> },
    {
      key: "actions",
      header: "",
      className: "w-12 text-right",
      cell: (s) =>
        can("suppressions.remove") && (
          <IconButton label={`Remove ${s.email}`} tone="danger" onClick={() => setRemoving(s)}>
            <Trash2 className="h-4 w-4" />
          </IconButton>
        ),
    },
  ];

  return (
    <>
      <PageHeader
        title="Suppressions"
        description="Addresses that never receive campaign email: unsubscribes, bounces and manual blocks."
        actions={can("suppressions.add") && <Button variant="primary" icon={<Plus className="h-4 w-4" />} onClick={() => setAdding(true)}>Suppress address</Button>}
      />
      <Card>
        <div className="flex flex-wrap items-center gap-3 border-b border-line p-4">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Find an address" className="w-72" />
          <SelectField
            aria-label="Filter by reason"
            value={reason}
            onChange={(e) => { setReason(e.target.value); setPage(1); }}
            options={[{ value: "", label: "All reasons" }, ...Object.entries(SUPPRESSION_REASON_LABELS).map(([value, label]) => ({ value, label }))]}
            className="w-52"
          />
          {list.data?.pagination && <span className="tabular ml-auto text-[13px] text-ink-subtle">{plural(list.data.pagination.total, "address", "addresses")}</span>}
        </div>
        {list.isError ? (
          <ErrorState error={list.error} onRetry={() => list.refetch()} />
        ) : (
          <>
            <DataTable
              columns={columns}
              rows={list.data?.data}
              rowKey={(s) => s.id}
              loading={list.isPending}
              caption="Suppressed addresses"
              empty={search || reason ? <EmptyState title="No matches" /> : <EmptyState icon={Ban} title="No suppressed addresses" description="Unsubscribes and bounces appear here automatically." />}
            />
            <Pagination pagination={list.data?.pagination} onPage={setPage} />
          </>
        )}
      </Card>
      <AddDialog open={adding} onClose={() => setAdding(false)} />
      <ConfirmDialog
        open={Boolean(removing)}
        onClose={() => setRemoving(null)}
        onConfirm={() => removing && remove.mutate(removing.id)}
        loading={remove.isPending}
        title={`Email ${removing?.email} again?`}
        description={removing?.reason === "UNSUBSCRIBE" || removing?.reason === "SPAM_COMPLAINT" ? "This person asked not to be emailed. Only remove them if they've asked to be added back." : "Future campaigns will be able to email this address."}
        confirmLabel="Remove from list"
      />
    </>
  );
}
