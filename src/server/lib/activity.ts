// Turns audit actions into sentences for the Activity view
type Meta = Record<string, unknown>;

const s = (v: unknown) => (v === undefined || v === null ? "" : String(v));
const plural = (n: unknown, word: string) => `${s(n)} ${word}${Number(n) === 1 ? "" : "s"}`;

const SUMMARIES: Record<string, (m: Meta) => string> = {
  "auth.login": () => "signed in",
  "auth.change_password": () => "changed their password",
  "auth.hub_login": () => "signed in through the Workspace",
  "auth.simple_login": (m) => `signed in as “${s(m.typedName)}” (${s(m.employeeCode)})${m.ip ? ` from ${s(m.ip)}` : ""}`,
  "auth.logout": (m) => `signed out${m.ip ? ` from ${s(m.ip)}` : ""}`,
  "simple.user_created": (m) => `joined with FR ID ${s(m.employeeCode)} as ${s(m.role).toLowerCase()}`,
  "simple.role_synced": (m) => `had their role set from FOUNDER_EMPLOYEE_CODES (${s(m.from).toLowerCase()} → ${s(m.to).toLowerCase()})`,
  "simple.kept_last_founder": () => "stayed a founder: FOUNDER_EMPLOYEE_CODES no longer lists them, but the team needs at least one active founder",
  "account.update_profile": () => "updated their profile and sending address",
  "list.update": (m) => `renamed or edited list ${s(m.name)}`,
  "enrichment.delete": (m) => `deleted a researched ${s(m.field)}`,
  "mailbox.test_connection": () => "tested the mailbox connection",
  "mailbox.check_inbox": () => "checked the inbox for bounces and replies",
  "settings.live_sending": (m) => `turned live sending ${m.enabled ? "on" : "off"}`,
  "settings.mailbox_account": (m) => `changed the sending mailbox to ${s(m.email)}`,
  "hub.user_created": (m) => `joined from the Workspace (${s(m.employeeCode)}) as ${s(m.role).toLowerCase()}`,
  "hub.role_synced": (m) => `had their role updated from the Workspace (${s(m.from).toLowerCase()} → ${s(m.to).toLowerCase()})`,
  "hub.kept_last_founder": () => "stayed a founder: the Workspace no longer lists them as one, but the team needs at least one active founder",
  "team.invite": (m) => `invited ${s(m.email)} as ${s(m.role).toLowerCase()}`,
  "team.accept_invite": () => "accepted their invite and joined the team",
  "team.update": (m) => `updated ${s(m.email)}${m.role ? ` (role: ${s(m.role).toLowerCase()})` : ""}${m.status ? ` (status: ${s(m.status).toLowerCase()})` : ""}`,
  "team.reset_link": (m) => `created a password reset link for ${s(m.email)}`,
  "contacts.import": (m) => `imported ${s(m.file)}${m.list ? ` into ${s(m.list)}` : ""}: ${s(m.created)} new, ${s(m.updated)} updated, ${s(m.skipped)} skipped`,
  "contacts.delete": (m) => `deleted ${plural(m.count, "contact")}`,
  "contact.create": (m) => `added contact ${s(m.email)}`,
  "contact.update": (m) => `edited contact ${s(m.email)}`,
  "list.create": (m) => `created list ${s(m.name)}`,
  "list.delete": (m) => `deleted list ${s(m.name)}`,
  "list.add_members": (m) => `added ${plural(m.added, "contact")} to ${s(m.name)}`,
  "list.remove_members": (m) => `removed ${plural(m.removed, "contact")} from a list`,
  "template.create": (m) => `created template ${s(m.name)}`,
  "template.update": (m) => `edited template ${s(m.name)} (v${s(m.version)})`,
  "template.duplicate": (m) => `duplicated template ${s(m.from)}`,
  "template.delete": (m) => `deleted template ${s(m.name)}`,
  "campaign.create": (m) => `created campaign ${s(m.name)}`,
  "campaign.update": () => "edited a campaign draft",
  "campaign.duplicate": (m) => `duplicated campaign ${s(m.from)}`,
  "campaign.delete": (m) => `deleted campaign ${s(m.name)}`,
  "campaign.request_approval": (m) => `submitted a campaign for approval (${plural(m.ready, "recipient")})`,
  "campaign.return_to_draft": (m) => `returned a campaign to draft${m.note ? `: "${s(m.note)}"` : ""}`,
  "campaign.approve": (m) => `approved a campaign for ${plural(m.recipients, "recipient")}`,
  "campaign.start": () => "started sending a campaign",
  "campaign.pause": () => "paused a campaign",
  "campaign.auto_pause": (m) => `— sending paused automatically: ${s(m.reason)}`,
  "campaign.resume": () => "resumed a campaign",
  "campaign.cancel": (m) => `cancelled a campaign (${plural(m.unsent, "unsent message")})`,
  "campaign.retry_failed": (m) => `retried ${plural(m.count, "failed message")}`,
  "campaign.test_send": (m) => `sent a test to ${Array.isArray(m.to) ? m.to.join(", ") : s(m.to)}`,
  "send.mark_sent": (m) => `marked the message to ${s(m.email)} as delivered`,
  "send.retry_unknown": (m) => `re-queued the message to ${s(m.email)}`,
  "suppression.add": (m) => `suppressed ${s(m.email)}`,
  "suppression.remove": (m) => `removed ${s(m.email)} from the suppression list`,
  "enrichment.add": (m) => `added a researched ${s(m.field)} from ${s(m.source)}`,
  "enrichment.verify": (m) => `verified a researched ${s(m.field)}`,
  "enrichment.reject": (m) => `rejected a researched ${s(m.field)}`,
  "enrichment.apply": (m) => `applied a researched ${s(m.field)} to a contact`,
};

export function summarize(action: string, metadata: unknown): string {
  const meta = metadata && typeof metadata === "object" ? (metadata as Meta) : {};
  return SUMMARIES[action]?.(meta) ?? action.replace(/[._]/g, " ");
}
