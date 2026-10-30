// Create contact, add to list, and new list dialogs
import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, errorMessage } from "../../lib/api";
import { useInvalidate, useLists } from "../../lib/queries";
import { plural } from "../../lib/format";
import { Button } from "../ui/Button";
import { SelectField, TextAreaField, TextField } from "../ui/Field";
import { Callout } from "../ui/Feedback";
import { Dialog } from "../ui/Overlay";
import { useToast } from "../ui/Toast";
import { ContactInputSchema, type ContactListDto } from "@shared/types";

export function NewListDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated?: (list: ContactListDto) => void }) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const invalidate = useInvalidate();
  const toast = useToast();
  const create = useMutation({
    mutationFn: () => api.post<ContactListDto>("/api/lists", { name, description: description || null }),
    onSuccess: async (res) => {
      await invalidate("lists");
      toast.success("List created", res.data.name);
      setName("");
      setDescription("");
      onCreated?.(res.data);
      onClose();
    },
  });
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!create.isPending}
      title="New list"
      description="Lists are the audiences you send campaigns to. A contact can be in many lists."
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => create.mutate()} disabled={!name.trim()} loading={create.isPending}>Create list</Button>
        </>
      }
    >
      <div className="space-y-4">
        <TextField label="Name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Goa boutique hotels" data-autofocus />
        <TextAreaField label="Description" optional value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
        {create.isError && <Callout tone="danger">{errorMessage(create.error)}</Callout>}
      </div>
    </Dialog>
  );
}

export function AddToListDialog({ contactIds, onClose, onDone }: { contactIds: string[]; onClose: () => void; onDone: () => void }) {
  const lists = useLists();
  const [listId, setListId] = useState("");
  const [creating, setCreating] = useState(false);
  const invalidate = useInvalidate();
  const toast = useToast();
  const add = useMutation({
    mutationFn: () => api.post<{ added: number; alreadyMembers: number }>(`/api/lists/${listId}/members`, { contactIds }),
    onSuccess: async (res) => {
      await invalidate("lists", "contacts");
      const name = lists.data?.data.find((l) => l.id === listId)?.name;
      toast.success(`Added to ${name}`, `${plural(res.data.added, "contact")} added${res.data.alreadyMembers ? `, ${res.data.alreadyMembers} already there` : ""}.`);
      onDone();
    },
  });
  if (creating) return <NewListDialog open onClose={() => setCreating(false)} onCreated={(l) => setListId(l.id)} />;
  return (
    <Dialog
      open
      onClose={onClose}
      dismissable={!add.isPending}
      title={`Add ${plural(contactIds.length, "contact")} to a list`}
      footer={
        <>
          <Button onClick={onClose} disabled={add.isPending}>Cancel</Button>
          <Button variant="primary" onClick={() => add.mutate()} disabled={!listId} loading={add.isPending}>Add to list</Button>
        </>
      }
    >
      <div className="space-y-3">
        <SelectField
          label="List"
          value={listId}
          onChange={(e) => setListId(e.target.value)}
          placeholder={lists.isPending ? "Loading…" : "Choose a list"}
          options={(lists.data?.data ?? []).map((l) => ({ value: l.id, label: `${l.name} (${plural(l.memberCount, "contact")})` }))}
        />
        <button className="link text-[13px]" onClick={() => setCreating(true)}>Create a new list</button>
        {add.isError && <Callout tone="danger">{errorMessage(add.error)}</Callout>}
      </div>
    </Dialog>
  );
}

export function NewContactDialog({ open, onClose, defaultListId }: { open: boolean; onClose: () => void; defaultListId?: string }) {
  const empty = { email: "", firstName: "", lastName: "", company: "", title: "", phone: "" };
  const [form, setForm] = useState(empty);
  const [errors, setErrors] = useState<Record<string, string | undefined>>({});
  const invalidate = useInvalidate();
  const toast = useToast();
  const create = useMutation({
    mutationFn: (body: unknown) => api.post("/api/contacts", body),
    onSuccess: async () => {
      await invalidate("contacts", "lists");
      toast.success("Contact added", form.email);
      setForm(empty);
      onClose();
    },
  });
  const submit = () => {
    const parsed = ContactInputSchema.safeParse(form);
    if (!parsed.success) {
      setErrors(Object.fromEntries(Object.entries(parsed.error.flatten().fieldErrors).map(([k, v]) => [k, v?.[0]])));
      return;
    }
    setErrors({});
    create.mutate({ ...parsed.data, listIds: defaultListId ? [defaultListId] : [] });
  };
  const field = (key: keyof typeof empty, label: string, extra?: { optional?: boolean; type?: string }) => (
    <TextField label={label} type={extra?.type} optional={extra?.optional} value={form[key]} onChange={(e) => setForm({ ...form, [key]: e.target.value })} error={errors[key]} />
  );
  return (
    <Dialog
      open={open}
      onClose={onClose}
      dismissable={!create.isPending}
      title="Add a contact"
      footer={
        <>
          <Button onClick={onClose} disabled={create.isPending}>Cancel</Button>
          <Button variant="primary" onClick={submit} loading={create.isPending}>Add contact</Button>
        </>
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">{field("email", "Email", { type: "email" })}</div>
        {field("firstName", "First name", { optional: true })}
        {field("lastName", "Last name", { optional: true })}
        {field("company", "Company", { optional: true })}
        {field("title", "Job title", { optional: true })}
        {field("phone", "Phone", { optional: true })}
        {create.isError && <Callout tone="danger" className="sm:col-span-2">{errorMessage(create.error)}</Callout>}
      </div>
    </Dialog>
  );
}
