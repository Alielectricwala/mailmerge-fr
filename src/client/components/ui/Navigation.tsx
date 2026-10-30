// Page header, tabs, filter chips, and a row-action menu
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { ChevronLeft, MoreHorizontal } from "lucide-react";
import { cn } from "../../lib/cn";

export function PageHeader({ title, description, actions, back, meta }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: { to: string; label: string }; meta?: ReactNode }) {
  return (
    <div className="mb-6">
      {back && (
        <Link to={back.to} className="mb-3 inline-flex items-center gap-1 text-[13px] font-medium text-ink-subtle hover:text-ink">
          <ChevronLeft className="h-4 w-4" />
          {back.label}
        </Link>
      )}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-3">
            <h1 className="text-xl font-semibold leading-7">{title}</h1>
            {meta}
          </div>
          {description && <p className="mt-1 text-[13px] text-ink-subtle">{description}</p>}
        </div>
        {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export interface TabItem<K extends string> {
  key: K;
  label: string;
  count?: number;
}

export function Tabs<K extends string>({ tabs, active, onChange, className }: { tabs: TabItem<K>[]; active: K; onChange: (key: K) => void; className?: string }) {
  return (
    <div role="tablist" className={cn("flex gap-6 overflow-x-auto border-b border-line", className)}>
      {tabs.map((t) => {
        const selected = t.key === active;
        return (
          <button
            key={t.key}
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(t.key)}
            className={cn(
              "-mb-px flex shrink-0 items-center gap-2 border-b-2 pb-2.5 pt-1 text-sm font-medium transition-colors",
              selected ? "border-brand text-ink" : "border-transparent text-ink-subtle hover:border-line-strong hover:text-ink"
            )}
          >
            {t.label}
            {t.count !== undefined && (
              <span className={cn("tabular rounded-full px-1.5 py-px text-xs", selected ? "bg-brand-soft text-brand-ink" : "bg-surface-sunken text-ink-subtle")}>{t.count.toLocaleString()}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Compact segmented filter, e.g. All / Sent / Failed */
export function FilterChips<K extends string>({ options, value, onChange, label }: { options: { key: K; label: string; count?: number }[]; value: K; onChange: (k: K) => void; label: string }) {
  return (
    <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={label}>
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.key)}
            className={cn(
              "inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium transition-colors",
              active ? "border-brand bg-brand-soft text-brand-ink" : "border-line bg-surface text-ink-muted hover:border-line-strong hover:text-ink"
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="tabular text-ink-subtle">{o.count.toLocaleString()}</span>}
          </button>
        );
      })}
    </div>
  );
}

export interface MenuItem {
  label: string;
  onSelect: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
  hidden?: boolean;
}

export function ActionMenu({ items, label = "More actions" }: { items: MenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const visible = items.filter((i) => !i.hidden);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === "Escape" : !ref.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, [open]);

  if (!visible.length) return null;
  return (
    <div ref={ref} className="relative" onClick={(e) => e.stopPropagation()}>
      <button
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-ink-subtle hover:bg-surface-sunken hover:text-ink"
      >
        <MoreHorizontal className="h-4 w-4" />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 z-dropdown mt-1 min-w-[180px] rounded-lg border border-line bg-surface py-1 shadow-pop animate-pop-in">
          {visible.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              disabled={item.disabled}
              onClick={() => {
                setOpen(false);
                item.onSelect();
              }}
              className={cn(
                "block w-full px-3 py-2 text-left text-[13px] disabled:opacity-40",
                item.tone === "danger" ? "text-danger hover:bg-danger-soft" : "text-ink hover:bg-surface-muted"
              )}
            >
              {item.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
