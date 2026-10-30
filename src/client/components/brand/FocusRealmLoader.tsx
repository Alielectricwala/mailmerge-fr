// Branded loading screen (full-screen boot state, or inline for a page area)
import { useEffect, useState } from "react";
import { cn } from "../../lib/cn";
import { BRAND_BLUE, BRAND_NAVY, BRAND_SKY, FocusRealmLogo } from "./FocusRealmLogo";

interface FocusRealmLoaderProps {
  size?: number;
  title?: string;
  subtitle?: string;
  status?: string;
  fullScreen?: boolean;
  /** 0–100; omit for an indeterminate bar */
  progress?: number;
  primaryColor?: string;
  accentColor?: string;
  /** Wait this long before showing anything, so fast loads don't flash */
  delayMs?: number;
}

export function FocusRealmLoader({
  size = 64,
  title = "FocusRealm",
  subtitle = "Mail Merge",
  status = "Loading your workspace…",
  fullScreen = true,
  progress,
  primaryColor = BRAND_NAVY,
  accentColor = BRAND_BLUE,
  delayMs = 0,
}: FocusRealmLoaderProps) {
  const [visible, setVisible] = useState(delayMs === 0);
  useEffect(() => {
    if (delayMs === 0) return;
    const timer = setTimeout(() => setVisible(true), delayMs);
    return () => clearTimeout(timer);
  }, [delayMs]);

  const content = (
    <div role="status" aria-live="polite" className={cn("mx-auto flex max-w-sm select-none flex-col items-center justify-center p-8 text-center", visible ? "animate-fade-in" : "invisible")}>
      <div className="relative mb-6">
        <div className="pointer-events-none absolute inset-0 -z-10 scale-125 rounded-3xl opacity-30 blur-xl motion-safe:animate-pulse" style={{ backgroundColor: accentColor }} />
        <FocusRealmLogo size={size} accentColor={BRAND_SKY} animated />
      </div>

      <p className="text-lg font-semibold tracking-tight" style={{ color: primaryColor }}>
        {title}
      </p>
      <p className="mt-0.5 text-2xs font-semibold uppercase tracking-[0.14em] text-ink-subtle">{subtitle}</p>

      <div className="relative mt-6 h-1 w-52 overflow-hidden rounded-full bg-line">
        {progress !== undefined ? (
          <div className="h-full rounded-full transition-[width] duration-300 ease-out" style={{ width: `${Math.min(100, Math.max(0, progress))}%`, backgroundColor: accentColor }} />
        ) : (
          <div className="h-full w-2/5 rounded-full motion-safe:animate-loader-bar" style={{ background: `linear-gradient(90deg, transparent, ${accentColor}, ${primaryColor}, transparent)` }} />
        )}
      </div>

      {status && <p className="mt-3.5 text-xs font-medium tracking-tight text-ink-faint">{status}</p>}
    </div>
  );

  if (fullScreen) {
    return <div className="fixed inset-0 z-modal flex min-h-screen items-center justify-center bg-canvas">{content}</div>;
  }
  return content;
}

/**
 * Branded splash over the first paint of every full page load. It stays for a moment even when the
 * app is ready sooner, so the brand reads as intentional rather than as a flicker, then fades out.
 */
export function BootSplash({ minMs = 1100 }: { minMs?: number }) {
  const [phase, setPhase] = useState<"shown" | "leaving" | "gone">("shown");
  useEffect(() => {
    // At least ~0.65s on screen even when the first load itself was slow
    const wait = Math.max(650, minMs - performance.now());
    const leave = setTimeout(() => setPhase("leaving"), wait);
    const gone = setTimeout(() => setPhase("gone"), wait + 320);
    return () => {
      clearTimeout(leave);
      clearTimeout(gone);
    };
  }, [minMs]);
  if (phase === "gone") return null;
  return (
    <div className={cn("fixed inset-0 z-toast transition-opacity duration-300", phase === "leaving" && "pointer-events-none opacity-0")} aria-hidden={phase === "leaving"}>
      <FocusRealmLoader />
    </div>
  );
}
