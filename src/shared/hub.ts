// The single Focus Realm website ("the hub"): the Workspace (sehejsharm/employee-management) serves
// this app under /mail, strips the prefix and adds HUB_HEADER. See docs/AUTH.md.
// No Node APIs here: the rules below are mirrored by middleware.js, which runs at Vercel's edge.

/** The header the Workspace adds to every request it forwards here, set to FOCUS_REALM_HUB_SECRET */
export const HUB_HEADER = "x-focusrealm-hub";

/** Where this app lives on the hub's address */
export const HUB_MOUNT = "/mail";

/** Normalizes VITE_BASE_PATH to "/" or "/segment/" */
export function normalizeBasePath(value: string | undefined | null): string {
  const trimmed = (value ?? "").trim().replace(/^\/+|\/+$/g, "");
  return trimmed ? `/${trimmed}/` : "/";
}

/**
 * Paths that are called on this app's own address, not through the hub:
 * Vercel Cron and the burst chain (/api/internal/*), unsubscribe links already sent in emails (/u/*),
 * and uptime checks (/health).
 */
export function isDirectPath(pathname: string): boolean {
  return pathname === "/health" || pathname.startsWith("/api/internal/") || pathname.startsWith("/u/");
}

/** Constant-time string comparison that works without Node's crypto (edge runtime) */
export function constantTimeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

/**
 * Hub mode only: where to send a request that reached this app's own address instead of the hub.
 * Returns null when the request may continue.
 */
export function hubRedirectTarget(input: {
  pathname: string;
  search: string;
  headerValue: string | null | undefined;
  secret: string | undefined;
  hubUrl: string | undefined;
}): string | null {
  if (!input.secret || !input.hubUrl) return null;
  if (isDirectPath(input.pathname)) return null;
  if (input.headerValue && constantTimeEqual(input.headerValue, input.secret)) return null;
  return `${input.hubUrl.replace(/\/+$/, "")}${HUB_MOUNT}${input.pathname}${input.search}`;
}

/** GET /api/auth/mode — how people sign in to this deployment */
export interface AuthModeDto {
  /** Signed in through the Workspace (FOCUS_REALM_HUB_SECRET and FOCUS_REALM_HUB_URL are set) */
  hub: boolean;
  /** The Workspace address, e.g. https://employee-management.vercel.app */
  hubUrl: string | null;
  /** The email/password form is available (always outside hub mode; founders only with ALLOW_PASSWORD_LOGIN in hub mode) */
  passwordLogin: boolean;
}
