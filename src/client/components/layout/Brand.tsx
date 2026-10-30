import { cn } from "../../lib/cn";
import { FocusRealmLogo } from "../brand/FocusRealmLogo";

export function BrandMark({ size = 32, className, animated }: { size?: number; className?: string; animated?: boolean }) {
  return <FocusRealmLogo size={size} className={className} animated={animated} />;
}

/** Logo and wordmark. */
export function BrandLockup({ className, size = "md", tone = "light" }: { className?: string; size?: "md" | "lg"; tone?: "light" | "dark" }) {
  const dark = tone === "dark";
  return (
    <div className={cn("flex items-center gap-2.5", className)}>
      <FocusRealmLogo size={size === "lg" ? 40 : 32} primaryColor={dark ? "#1C2F62" : undefined} />
      <div className="leading-tight">
        <p className={cn("font-semibold tracking-tight", dark ? "text-white" : "text-navy", size === "lg" ? "text-lg" : "text-[15px]")}>FocusRealm</p>
        <p className={cn("font-semibold uppercase tracking-[0.12em]", dark ? "text-white/50" : "text-ink-subtle", size === "lg" ? "text-[11px]" : "text-2xs")}>Mail Merge</p>
      </div>
    </div>
  );
}
