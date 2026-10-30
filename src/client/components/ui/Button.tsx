import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "../../lib/cn";
import { Spinner } from "./Spinner";

type Variant = "primary" | "secondary" | "ghost" | "danger" | "danger-ghost";
type Size = "sm" | "md";

const base =
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-md font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:shadow-focus disabled:pointer-events-none disabled:opacity-50";

const variants: Record<Variant, string> = {
  primary: "bg-brand text-white shadow-xs hover:bg-brand-hover",
  secondary: "border border-line bg-surface text-ink shadow-xs hover:bg-surface-muted hover:border-line-strong",
  ghost: "text-ink-muted hover:bg-surface-sunken hover:text-ink",
  danger: "bg-danger text-white shadow-xs hover:bg-danger-hover",
  "danger-ghost": "text-danger hover:bg-danger-soft",
};

const sizes: Record<Size, string> = {
  sm: "h-8 px-3 text-[13px]",
  md: "h-9 px-3.5 text-sm",
};

export function buttonClasses(variant: Variant = "secondary", size: Size = "md", className?: string) {
  return cn(base, variants[variant], sizes[size], className);
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  icon?: ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "secondary", size = "md", loading = false, icon, disabled, className, children, type = "button", ...props },
  ref
) {
  return (
    <button ref={ref} type={type} disabled={disabled || loading} aria-busy={loading || undefined} className={buttonClasses(variant, size, className)} {...props}>
      {loading ? <Spinner size={14} className={variant === "primary" || variant === "danger" ? "text-white" : undefined} /> : icon}
      {children}
    </button>
  );
});

export function ButtonLink({ variant = "secondary", size = "md", icon, className, children, ...props }: LinkProps & { variant?: Variant; size?: Size; icon?: ReactNode }) {
  return (
    <Link className={buttonClasses(variant, size, className)} {...props}>
      {icon}
      {children}
    </Link>
  );
}

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { label: string; tone?: "default" | "danger" }>(
  function IconButton({ label, tone = "default", className, children, type = "button", ...props }, ref) {
    return (
      <button
        ref={ref}
        type={type}
        aria-label={label}
        title={label}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:shadow-focus disabled:opacity-40",
          tone === "danger" ? "text-ink-subtle hover:bg-danger-soft hover:text-danger" : "text-ink-subtle hover:bg-surface-sunken hover:text-ink",
          className
        )}
        {...props}
      >
        {children}
      </button>
    );
  }
);
