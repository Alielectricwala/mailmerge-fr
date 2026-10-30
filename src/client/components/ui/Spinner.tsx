import { cn } from "../../lib/cn";
import { FocusRealmLogo } from "../brand/FocusRealmLogo";

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className={cn("animate-spin text-brand", className)} aria-hidden="true">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("animate-pulse rounded bg-surface-sunken", className)} aria-hidden="true" />;
}

export function PageLoader({ label = "Loading" }: { label?: string }) {
  return (
    <div className="flex animate-fade-in flex-col items-center justify-center gap-3 py-16 text-[13px] text-ink-subtle" role="status">
      <FocusRealmLogo size={30} animated />
      <span>{label}…</span>
    </div>
  );
}
