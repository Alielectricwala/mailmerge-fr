// Form fields: one label/hint/error layout for every control
import { forwardRef, useId, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, Eye, EyeOff, Search } from "lucide-react";
import { cn } from "../../lib/cn";

interface FieldShellProps {
  label?: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  optional?: boolean;
  className?: string;
  children: (ids: { id: string; describedBy?: string; invalid: boolean }) => ReactNode;
}

export function FieldShell({ label, hint, error, optional, className, children }: FieldShellProps) {
  const id = useId();
  const hintId = hint ? `${id}-hint` : undefined;
  const errorId = error ? `${id}-error` : undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      {label && (
        <label htmlFor={id} className="flex items-baseline justify-between text-[13px] font-medium text-ink">
          <span>{label}</span>
          {optional && <span className="text-xs font-normal text-ink-subtle">Optional</span>}
        </label>
      )}
      {children({ id, describedBy: [errorId, hintId].filter(Boolean).join(" ") || undefined, invalid: Boolean(error) })}
      {error ? (
        <p id={errorId} className="text-xs text-danger" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={hintId} className="text-xs text-ink-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

type Common = { label?: ReactNode; hint?: ReactNode; error?: string | null; optional?: boolean; containerClassName?: string };

export const TextField = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement> & Common>(function TextField(
  { label, hint, error, optional, containerClassName, className, ...props },
  ref
) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <input ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn("control h-9", className)} {...props} />
      )}
    </FieldShell>
  );
});

/** Password input with a show/hide toggle */
export const PasswordField = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, "type"> & Common>(function PasswordField(
  { label, hint, error, optional, containerClassName, className, ...props },
  ref
) {
  const [shown, setShown] = useState(false);
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <div className="relative">
          <input ref={ref} id={id} type={shown ? "text" : "password"} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn("control h-9 pr-10", className)} {...props} />
          <button
            type="button"
            onClick={() => setShown((v) => !v)}
            aria-label={shown ? "Hide password" : "Show password"}
            aria-pressed={shown}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center rounded-r-md text-ink-faint hover:text-ink-muted"
          >
            {shown ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
      )}
    </FieldShell>
  );
});

export const TextAreaField = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement> & Common>(function TextAreaField(
  { label, hint, error, optional, containerClassName, className, ...props },
  ref
) {
  return (
    <FieldShell label={label} hint={hint} error={error} optional={optional} className={containerClassName}>
      {({ id, describedBy, invalid }) => (
        <textarea ref={ref} id={id} aria-describedby={describedBy} aria-invalid={invalid || undefined} className={cn("control min-h-[88px] resize-y leading-relaxed", className)} {...props} />
      )}
    </FieldShell>
  );
});

export interface Option {
  value: string;
  label: string;
  disabled?: boolean;
}

export const SelectField = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement> & Common & { options: Option[]; placeholder?: string }>(
  function SelectField({ label, hint, error, optional, containerClassName, className, options, placeholder, ...props }, ref) {
    return (
      <FieldShell label={label} hint={hint} error={error} optional={optional} className={containerClassName}>
        {({ id, describedBy, invalid }) => (
          <div className="relative w-full">
            <select
              ref={ref}
              id={id}
              aria-describedby={describedBy}
              aria-invalid={invalid || undefined}
              className={cn(
                "control h-9 w-full appearance-none rounded-md border border-line bg-surface pl-3 pr-8 text-xs font-medium text-ink transition-colors cursor-pointer shadow-xs",
                "hover:border-line-strong focus:border-brand focus:ring-1 focus:ring-brand/20",
                className
              )}
              {...props}
            >
              {placeholder !== undefined && (
                <option value="" disabled className="text-ink-faint">
                  {placeholder}
                </option>
              )}
              {options.map((o) => (
                <option key={o.value} value={o.value} disabled={o.disabled} className="text-ink bg-surface py-1">
                  {o.label}
                </option>
              ))}
            </select>
            <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-2.5 text-ink-subtle">
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </div>
          </div>
        )}
      </FieldShell>
    );
  }
);

export function Checkbox({ label, description, className, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; description?: ReactNode }) {
  const id = useId();
  return (
    <label htmlFor={id} className={cn("flex cursor-pointer items-start gap-2.5", props.disabled && "cursor-not-allowed opacity-60", className)}>
      <input id={id} type="checkbox" className="mt-0.5 h-4 w-4 rounded border-line-strong text-brand accent-[rgb(var(--brand))] focus-visible:shadow-focus" {...props} />
      <span>
        <span className="block text-sm text-ink">{label}</span>
        {description && <span className="block text-xs text-ink-subtle">{description}</span>}
      </span>
    </label>
  );
}

export function SearchInput({ value, onChange, placeholder = "Search", className, label }: { value: string; onChange: (v: string) => void; placeholder?: string; className?: string; label?: string }) {
  return (
    <div className={cn("relative", className)}>
      <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" aria-hidden="true" />
      <input
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={label ?? placeholder}
        className="control h-9 pl-9"
      />
    </div>
  );
}

/** Selectable card used for radio-style choices (e.g. duplicate policy) */
export function ChoiceCard({ checked, onSelect, title, description, name, value }: { checked: boolean; onSelect: () => void; title: string; description?: string; name: string; value: string }) {
  return (
    <label
      className={cn(
        "flex cursor-pointer items-start gap-3 rounded-lg border p-3.5 transition-colors",
        checked ? "border-brand bg-brand-soft/60 ring-1 ring-brand" : "border-line bg-surface hover:border-line-strong"
      )}
    >
      <input type="radio" name={name} value={value} checked={checked} onChange={onSelect} className="mt-0.5 h-4 w-4 accent-[rgb(var(--brand))]" />
      <span>
        <span className="block text-sm font-medium text-ink">{title}</span>
        {description && <span className="mt-0.5 block text-xs leading-relaxed text-ink-subtle">{description}</span>}
      </span>
    </label>
  );
}
