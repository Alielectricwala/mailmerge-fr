// FocusRealm mark: a sealed envelope held inside focus brackets — "outreach, in focus".
// Static by default; `animated` brings the brackets into focus and re-seals the flap on a loop.
// Motion is dropped for people who ask for reduced motion (motion-safe: variants).
import { cn } from "../../lib/cn";

export const BRAND_NAVY = "#0D1B3E";
export const BRAND_BLUE = "#2168E8";
export const BRAND_SKY = "#5B9BFF";

interface FocusRealmLogoProps {
  size?: number;
  /** Tile colour */
  primaryColor?: string;
  /** Focus brackets */
  accentColor?: string;
  animated?: boolean;
  className?: string;
  /** Accessible name; omit when the logo sits next to visible brand text */
  title?: string;
}

export function FocusRealmLogo({ size = 32, primaryColor = "#FFFFFF", accentColor = BRAND_BLUE, animated = false, className, title }: FocusRealmLogoProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      fill="none"
      className={cn("shrink-0", className)}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
    >
      <rect x="0.5" y="0.5" width="47" height="47" rx="12" fill={primaryColor} stroke="#DFE5EF" />

      <g
        stroke={accentColor}
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ transformOrigin: "24px 24px" }}
        className={cn(animated && "motion-safe:animate-fr-focus")}
      >
        <path d="M9 16.5V12a3 3 0 0 1 3-3h4.5" />
        <path d="M31.5 9H36a3 3 0 0 1 3 3v4.5" />
        <path d="M39 31.5V36a3 3 0 0 1-3 3h-4.5" />
        <path d="M16.5 39H12a3 3 0 0 1-3-3v-4.5" />
      </g>

      <g stroke="#fff" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <rect x="14.5" y="16.5" width="19" height="15" rx="3" fill="#EBF2FE" stroke={BRAND_NAVY} />
        <path d="M16.5 18.5 24 24.25 31.5 18.5" stroke={accentColor} pathLength={1} strokeDasharray={animated ? 1 : undefined} className={cn(animated && "motion-safe:animate-fr-seal")} />
      </g>
    </svg>
  );
}
