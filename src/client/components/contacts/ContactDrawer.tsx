// Contact detail: edit, lists, researched details, campaign history
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { useContact, useInvalidate } from "../../lib/queries";
import { useAuth } from "../../lib/auth";
import { contactName, formatDate, formatDateTime } from "../../lib/format";
import { CheckCircle2, AlertTriangle, ShieldCheck } from "lucide-react";
import { SelectField, TextField } from "../ui/Field";
import { Button } from "../ui/Button";
import { Badge, DeliveryStatusBadge } from "../ui/Badge";
import { Callout, ErrorState } from "../ui/Feedback";
import { Drawer } from "../ui/Overlay";
import { PageLoader } from "../ui/Spinner";
import { useToast } from "../ui/Toast";
import { EnrichmentSection } from "./EnrichmentSection";
import { AddToListDialog } from "./ContactDialogs";
import {
  ContactInputSchema,
  CONTACT_PERSONAS,
  CONTACT_PERSONA_LABELS,
  HOTEL_SEGMENTS,
  HOTEL_SEGMENT_LABELS,
  SUPPRESSION_REASON_LABELS,
} from "@shared/types";

const FIELDS = [
  { key: "firstName", label: "First name" },
  { key: "lastName", label: "Last name" },
  { key: "company", label: "Company" },
  { key: "title", label: "Job title" },
  { key: "phone", label: "Phone" },
] as const;

type Form = Record<(typeof FIELDS)[number]["key"] | "email" | "hotelSegment" | "contactPersona", string>;

export function ContactDrawer({ contactId, onClose }: { contactId: string; onClose: () => void }) {
  const contact = useContact(contactId);
  const { can } = useAuth();
  const toast = useToast();
  const invalidate = useInvalidate();
  const [form, setForm] = useState<Form | null>(null);
  const [custom, setCustom] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [addingToList, setAddingToList] = useState(false);
  const c = contact.data?.data;

  useEffect(() => {
    if (c) {
      setForm({
        email: c.email,
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        company: c.company ?? "",
        title: c.title ?? "",
        phone: c.phone ?? "",
        hotelSegment: c.hotelSegment ?? "",
        contactPersona: c.contactPersona ?? "",
      });
      setCustom(c.customFields);
    }
  }, [c]);

  const save = useMutation({
    mutationFn: (body: unknown) => api.patch(`/api/contacts/${contactId}`, body),
    onSuccess: async () => {
      await invalidate("contacts", "lists");
      toast.success("Contact saved");
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const verifyClassification = useMutation({
    mutationFn: () =>
      api.patch(`/api/contacts/${contactId}/classification`, {
        hotelSegmentStatus: form?.hotelSegment ? "VERIFIED" : undefined,
        hotelSegmentConfidence: form?.hotelSegment ? 1.0 : undefined,
        contactPersonaStatus: form?.contactPersona ? "VERIFIED" : undefined,
        contactPersonaConfidence: form?.contactPersona ? 1.0 : undefined,
      }),
    onSuccess: async () => {
      await invalidate("contacts", "lists");
      toast.success("Classification verified");
    },
    onError: (err) => setError(errorMessage(err)),
  });

  const removeFromList = useMutation({
    mutationFn: (listId: string) => api.post(`/api/lists/${listId}/members/remove`, { contactIds: [contactId] }),
    onSuccess: () => invalidate("contacts", "lists"),
    onError: (err) => toast.error("Couldn't remove", errorMessage(err)),
  });

  const editable = can("contacts.manage");
  const initialCompare = c
    ? JSON.stringify({
        email: c.email,
        firstName: c.firstName ?? "",
        lastName: c.lastName ?? "",
        company: c.company ?? "",
        title: c.title ?? "",
        phone: c.phone ?? "",
        hotelSegment: c.hotelSegment ?? "",
        contactPersona: c.contactPersona ?? "",
      })
    : "";
  const dirty = Boolean(c && form && (JSON.stringify(form) !== initialCompare || JSON.stringify(custom) !== JSON.stringify(c.customFields)));

  const submit = () => {
    const parsed = ContactInputSchema.safeParse({
      ...form,
      hotelSegment: form?.hotelSegment || null,
      contactPersona: form?.contactPersona || null,
      customFields: custom,
    });
    if (!parsed.success) return setError(parsed.error.issues[0]?.message ?? "Check the details.");
    setError(null);
    save.mutate(parsed.data);
  };

  const hotelSegmentOptions = [
    { value: "", label: "Select hotel segment..." },
    ...HOTEL_SEGMENTS.map((s) => ({ value: s, label: HOTEL_SEGMENT_LABELS[s] })),
  ];

  const contactPersonaOptions = [
    { value: "", label: "Select contact persona..." },
    ...CONTACT_PERSONAS.map((p) => ({ value: p, label: CONTACT_PERSONA_LABELS[p] })),
  ];

  const renderStatusBadge = (status?: string | null, confidence?: number | null) => {
    if (status === "VERIFIED" || status === "MANUAL") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 border border-emerald-200">
          <CheckCircle2 className="h-3 w-3" />
          {status === "VERIFIED" ? "Verified" : "Manual entry"}
        </span>
      );
    }
    if (status === "GUESSED") {
      return (
        <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-700 border border-amber-200">
          <AlertTriangle className="h-3 w-3" />
          Unverified estimate {confidence ? `(${Math.round(confidence * 100)}%)` : ""}
        </span>
      );
    }
    return (
      <span className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-medium text-ink-muted border border-line">
        Unclassified
      </span>
    );
  };

  return (
    <Drawer
      open
      onClose={onClose}
      title={c ? contactName(c) || c.email : "Contact"}
      subtitle={c && (contactName(c) ? c.email : c.company)}
      footer={
        editable && c && (
          <>
            <Button onClick={onClose}>Close</Button>
            <Button variant="primary" disabled={!dirty} loading={save.isPending} onClick={submit}>Save changes</Button>
          </>
        )
      }
    >
      {contact.isPending || !form ? (
        contact.isError ? <ErrorState error={contact.error} onRetry={() => contact.refetch()} /> : <PageLoader />
      ) : (
        c && (
          <div className="space-y-7">
            {c.suppression && (
              <Callout tone="warning" title={`Suppressed: ${SUPPRESSION_REASON_LABELS[c.suppression.reason]}`}>
                Campaigns skip this address. <Link to="/suppressions" className="link">Manage suppressions</Link>
              </Callout>
            )}

            <section className="space-y-4">
              <h3 className="text-[13px] font-semibold">Details</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                <TextField label="Email" containerClassName="sm:col-span-2" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} disabled={!editable} />
                {FIELDS.map((f) => (
                  <TextField key={f.key} label={f.label} value={form[f.key]} onChange={(e) => setForm({ ...form, [f.key]: e.target.value })} disabled={!editable} />
                ))}
              </div>
            </section>

            <section className="space-y-4 rounded-lg border border-line bg-surface-subtle p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-[13px] font-semibold">Segmentation & Persona</h3>
                  <p className="text-xs text-ink-muted">Used for template assignment and outreach personalization</p>
                </div>
                {editable && (c.hotelSegmentStatus === "GUESSED" || c.contactPersonaStatus === "GUESSED") && (
                  <Button
                    size="sm"
                    variant="secondary"
                    icon={<ShieldCheck className="h-3.5 w-3.5 text-emerald-600" />}
                    loading={verifyClassification.isPending}
                    onClick={() => verifyClassification.mutate()}
                  >
                    Confirm as verified
                  </Button>
                )}
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-subtle">Hotel Segment</span>
                    {renderStatusBadge(c.hotelSegmentStatus, c.hotelSegmentConfidence)}
                  </div>
                  <SelectField
                    value={form.hotelSegment}
                    onChange={(e) => setForm({ ...form, hotelSegment: e.target.value })}
                    options={hotelSegmentOptions}
                    disabled={!editable}
                  />
                </div>

                <div className="space-y-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-ink-subtle">Contact Persona</span>
                    {renderStatusBadge(c.contactPersonaStatus, c.contactPersonaConfidence)}
                  </div>
                  <SelectField
                    value={form.contactPersona}
                    onChange={(e) => setForm({ ...form, contactPersona: e.target.value })}
                    options={contactPersonaOptions}
                    disabled={!editable}
                  />
                </div>
              </div>

              {(c.hotelSegmentStatus === "GUESSED" || c.contactPersonaStatus === "GUESSED") && (
                <p className="text-[11px] text-amber-700 bg-amber-50 rounded p-2 border border-amber-200">
                  Unverified estimates are derived from title or company heuristics and are never treated as confirmed facts.
                </p>
              )}
            </section>

            <section className="space-y-4">
              {Object.keys(custom).length > 0 && (
                <div className="space-y-3">
                  <p className="text-xs font-medium text-ink-subtle">Custom fields (use as {"{{fieldName}}"} in templates)</p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    {Object.entries(custom).map(([k, v]) => (
                      <TextField key={k} label={k} value={v} onChange={(e) => setCustom({ ...custom, [k]: e.target.value })} disabled={!editable} />
                    ))}
                  </div>
                </div>
              )}
              {error && <Callout tone="danger">{error}</Callout>}
              <p className="text-xs text-ink-faint">Added {formatDate(c.importedAt)} via {c.source ?? "manual entry"} · updated {formatDate(c.updatedAt)}</p>
            </section>

            <section>
              <div className="mb-2 flex items-center justify-between">
                <h3 className="text-[13px] font-semibold">Lists</h3>
                {editable && <Button size="sm" variant="ghost" onClick={() => setAddingToList(true)}>Add to list</Button>}
              </div>
              {c.lists.length ? (
                <div className="flex flex-wrap gap-1.5">
                  {c.lists.map((l) => (
                    <span key={l.id} className="inline-flex items-center gap-1 rounded-full border border-line bg-surface-muted py-0.5 pl-2.5 pr-1 text-xs">
                      <Link to={`/lists/${l.id}`} className="hover:underline">{l.name}</Link>
                      {editable && (
                        <button className="rounded-full px-1 text-ink-faint hover:bg-surface-sunken hover:text-ink" aria-label={`Remove from ${l.name}`} onClick={() => removeFromList.mutate(l.id)}>
                          ×
                        </button>
                      )}
                    </span>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-ink-faint">Not in any list. Campaigns only reach contacts in their list.</p>
              )}
            </section>

            <EnrichmentSection contactId={contactId} />

            <section>
              <h3 className="mb-2 text-[13px] font-semibold">Campaign history</h3>
              {c.history.length ? (
                <ul className="divide-y divide-line rounded-lg border border-line">
                  {c.history.map((h) => (
                    <li key={h.id} className="flex items-center justify-between gap-3 px-3 py-2.5 text-[13px]">
                      <Link to={`/campaigns/${h.campaign.id}`} className="truncate hover:underline">{h.campaign.name}</Link>
                      <span className="flex shrink-0 items-center gap-2">
                        {h.repliedAt && <Badge tone="success">Replied</Badge>}
                        {h.bouncedAt && <Badge tone="danger">Bounced</Badge>}
                        <DeliveryStatusBadge status={h.status} />
                        <span className="text-xs text-ink-subtle">{formatDateTime(h.sentAt)}</span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-ink-faint">Hasn't been emailed by a campaign yet.</p>
              )}
            </section>
          </div>
        )
      )}
      {addingToList && <AddToListDialog contactIds={[contactId]} onClose={() => setAddingToList(false)} onDone={() => setAddingToList(false)} />}
    </Drawer>
  );
}
