// Display formatting

const dateFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat(undefined, { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });
const relFmt = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });

export function formatDate(iso: string | null | undefined): string {
  return iso ? dateFmt.format(new Date(iso)) : "—";
}

export function formatDateTime(iso: string | null | undefined): string {
  return iso ? dateTimeFmt.format(new Date(iso)) : "—";
}

/** "3 minutes ago", "yesterday", falling back to a date after a week */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return "—";
  const seconds = (new Date(iso).getTime() - Date.now()) / 1000;
  const abs = Math.abs(seconds);
  if (abs < 45) return "just now";
  if (abs < 3600) return relFmt.format(Math.round(seconds / 60), "minute");
  if (abs < 86400) return relFmt.format(Math.round(seconds / 3600), "hour");
  if (abs < 7 * 86400) return relFmt.format(Math.round(seconds / 86400), "day");
  return formatDate(iso);
}

export function num(n: number): string {
  return n.toLocaleString();
}

export function plural(n: number, singular: string, pluralForm = `${singular}s`): string {
  return `${n.toLocaleString()} ${n === 1 ? singular : pluralForm}`;
}

export function percent(part: number, whole: number): string {
  if (!whole) return "0%";
  const p = (part / whole) * 100;
  return `${p < 10 && p > 0 ? p.toFixed(1) : Math.round(p)}%`;
}

export function contactName(c: { firstName?: string | null; lastName?: string | null }): string {
  return [c.firstName, c.lastName].filter(Boolean).join(" ");
}

export function initials(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]!.toUpperCase())
      .join("") || "?"
  );
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? "Good morning" : h < 18 ? "Good afternoon" : "Good evening";
}
