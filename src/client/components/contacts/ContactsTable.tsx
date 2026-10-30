// Contacts table with search, selection, bulk actions and detail drawer (used on Contacts and List pages)
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Users } from "lucide-react";
import { api, errorMessage } from "../../lib/api";
import { useContacts, useInvalidate } from "../../lib/queries";
import { useDebounced } from "../../lib/hooks";
import { useAuth } from "../../lib/auth";
import { contactName, plural, timeAgo } from "../../lib/format";
import { Card } from "../ui/Card";
import { Badge } from "../ui/Badge";
import { Button } from "../ui/Button";
import { SearchInput } from "../ui/Field";
import { DataTable, Pagination, type Column } from "../ui/DataTable";
import { FilterChips } from "../ui/Navigation";
import { EmptyState, ErrorState } from "../ui/Feedback";
import { ConfirmDialog } from "../ui/Overlay";
import { useToast } from "../ui/Toast";
import { ContactDrawer } from "./ContactDrawer";
import { AddToListDialog } from "./ContactDialogs";
import {
  CONTACT_PERSONA_LABELS,
  HOTEL_SEGMENT_LABELS,
  SUPPRESSION_REASON_LABELS,
  type ContactDto,
  type ContactPersona,
  type HotelSegment,
} from "@shared/types";

export function ContactsTable({ listId, listName, emptyAction }: { listId?: string; listName?: string; emptyAction?: React.ReactNode }) {
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | "no_list" | "suppressed">("all");
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openId, setOpenId] = useState<string | null>(null);
  const [dialog, setDialog] = useState<null | "add" | "remove" | "delete">(null);
  const contacts = useContacts({ page, search: useDebounced(search), listId, filter: filter === "all" ? undefined : filter });
  const ids = [...selected];

  const removeFromList = useMutation({
    mutationFn: () => api.post(`/api/lists/${listId}/members/remove`, { contactIds: ids }),
    onSuccess: async () => {
      await invalidate("contacts", "lists");
      toast.success(`Removed from ${listName}`, plural(ids.length, "contact"));
      setSelected(new Set());
      setDialog(null);
    },
    onError: (err) => toast.error("Couldn't remove", errorMessage(err)),
  });
  const remove = useMutation({
    mutationFn: () => api.post<{ deleted: number }>("/api/contacts/delete", { ids }),
    onSuccess: async (res) => {
      await invalidate("contacts", "lists", "overview");
      toast.success("Contacts deleted", plural(res.data.deleted, "contact"));
      setSelected(new Set());
      setDialog(null);
    },
    onError: (err) => toast.error("Couldn't delete", errorMessage(err)),
  });

  const columns: Column<ContactDto>[] = [
    {
      key: "name",
      header: "Contact",
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate font-medium">{contactName(c) || c.email}</p>
          {contactName(c) && <p className="truncate text-xs text-ink-subtle">{c.email}</p>}
        </div>
      ),
      className: "max-w-[260px]",
    },
    {
      key: "company",
      header: "Company",
      cell: (c) => (
        <div className="min-w-0">
          <p className="truncate">{c.company ?? <span className="text-ink-faint">—</span>}</p>
          {c.title && <p className="truncate text-xs text-ink-subtle">{c.title}</p>}
        </div>
      ),
      className: "max-w-[200px]",
    },
    {
      key: "classification",
      header: "Segment & Persona",
      cell: (c) => {
        const seg = c.hotelSegment ? (HOTEL_SEGMENT_LABELS[c.hotelSegment as HotelSegment] ?? c.hotelSegment) : null;
        const per = c.contactPersona ? (CONTACT_PERSONA_LABELS[c.contactPersona as ContactPersona] ?? c.contactPersona) : null;
        const isVerified =
          c.hotelSegmentStatus === "VERIFIED" ||
          c.hotelSegmentStatus === "MANUAL" ||
          c.contactPersonaStatus === "VERIFIED" ||
          c.contactPersonaStatus === "MANUAL";
        const isGuessed = (c.hotelSegmentStatus === "GUESSED" || c.contactPersonaStatus === "GUESSED") && !isVerified;

        if (!seg && !per) {
          return <span className="text-xs text-ink-faint">—</span>;
        }

        return (
          <div className="flex flex-wrap items-center gap-1">
            {seg && (
              <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                {seg}
              </span>
            )}
            {per && (
              <span className="rounded border border-line bg-surface-muted px-1.5 py-0.5 text-[11px] font-medium text-ink-muted">
                {per}
              </span>
            )}
            {isVerified && (
              <span className="text-[11px] font-semibold text-emerald-600" title="Verified attribute">
                ✓
              </span>
            )}
            {isGuessed && (
              <span className="text-[11px] font-medium text-amber-600" title="Unverified estimate">
                ~
              </span>
            )}
          </div>
        );
      },
      className: "max-w-[220px]",
    },
    {
      key: "lists",
      header: "Lists",
      cell: (c) =>
        c.suppression ? (
          <Badge tone="warning">{SUPPRESSION_REASON_LABELS[c.suppression.reason]}</Badge>
        ) : c.lists.length ? (
          <span className="text-xs text-ink-muted">{c.lists.slice(0, 2).map((l) => l.name).join(", ")}{c.lists.length > 2 ? ` +${c.lists.length - 2}` : ""}</span>
        ) : (
          <span className="text-xs text-ink-faint">No list</span>
        ),
    },
    { key: "added", header: "Added", cell: (c) => <span className="whitespace-nowrap text-ink-muted">{timeAgo(c.importedAt)}</span> },
  ];

  const total = contacts.data?.pagination?.total;
  const isFiltered = Boolean(search) || filter !== "all";

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
        <div className="flex flex-wrap items-center gap-3">
          <SearchInput value={search} onChange={(v) => { setSearch(v); setPage(1); }} placeholder="Search name, email or company" className="w-72" />
          {!listId && (
            <FilterChips
              label="Filter contacts"
              value={filter}
              onChange={(f) => { setFilter(f); setPage(1); }}
              options={[
                { key: "all", label: "All" },
                { key: "no_list", label: "Not in a list" },
                { key: "suppressed", label: "Suppressed" },
              ]}
            />
          )}
        </div>
        {selected.size > 0 && can("contacts.manage") ? (
          <div className="flex items-center gap-2">
            <span className="text-[13px] text-ink-muted">{plural(selected.size, "selected", "selected")}</span>
            <Button size="sm" onClick={() => setDialog("add")}>Add to list</Button>
            {listId && <Button size="sm" onClick={() => setDialog("remove")}>Remove from list</Button>}
            <Button size="sm" variant="danger-ghost" onClick={() => setDialog("delete")}>Delete</Button>
          </div>
        ) : (
          total !== undefined && <span className="tabular text-[13px] text-ink-subtle">{plural(total, "contact")}</span>
        )}
      </div>

      {contacts.isError ? (
        <ErrorState error={contacts.error} onRetry={() => contacts.refetch()} />
      ) : (
        <>
          <DataTable
            columns={columns}
            rows={contacts.data?.data}
            rowKey={(c) => c.id}
            loading={contacts.isPending}
            onRowClick={(c) => setOpenId(c.id)}
            selection={can("contacts.manage") ? { selected, onChange: setSelected } : undefined}
            caption="Contacts"
            empty={isFiltered ? <EmptyState title="No matching contacts" description="Try a different search or filter." /> : <EmptyState icon={Users} title={listId ? "This list is empty" : "No contacts yet"} description={listId ? "Add contacts from the Contacts page, or import a file into this list." : "Import a CSV or Excel file to get started."} action={emptyAction} />}
          />
          <Pagination pagination={contacts.data?.pagination} onPage={setPage} />
        </>
      )}

      {openId && <ContactDrawer contactId={openId} onClose={() => setOpenId(null)} />}
      {dialog === "add" && <AddToListDialog contactIds={ids} onClose={() => setDialog(null)} onDone={() => { setDialog(null); setSelected(new Set()); }} />}
      <ConfirmDialog
        open={dialog === "remove"}
        onClose={() => setDialog(null)}
        onConfirm={() => removeFromList.mutate()}
        loading={removeFromList.isPending}
        tone="primary"
        title={`Remove ${plural(ids.length, "contact")} from ${listName}?`}
        description="They stay in your contacts and other lists. Campaigns already approved aren't affected."
        confirmLabel="Remove from list"
      />
      <ConfirmDialog
        open={dialog === "delete"}
        onClose={() => setDialog(null)}
        onConfirm={() => remove.mutate()}
        loading={remove.isPending}
        title={`Delete ${plural(ids.length, "contact")}?`}
        description="They're removed from every list. Their past campaign messages stay in the logs. This can't be undone."
        confirmLabel="Delete contacts"
      />
    </Card>
  );
}
