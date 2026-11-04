// Vercel Routing Middleware: runs before static files and the API function, so it covers the client
// pages too. In hub mode (FOCUS_REALM_HUB_SECRET and FOCUS_REALM_HUB_URL set), anything that
// reaches this app's own address without the hub header is sent to the same page on the hub.
//
// Plain JavaScript and self-contained, like api/index.js. The rules mirror hubRedirectTarget in
// src/shared/hub.ts (Express applies that one to the API); src/shared/hub.test.ts checks both agree.
import { next } from "@vercel/functions/middleware";

const HUB_HEADER = "x-focusrealm-hub";
const HUB_MOUNT = "/mail";

function isDirectPath(pathname) {
  return pathname === "/health" || pathname.startsWith("/api/internal/") || pathname.startsWith("/u/");
}

function constantTimeEqual(a, b) {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export function hubRedirectTarget({ pathname, search, headerValue, secret, hubUrl }) {
  if (!secret || !hubUrl) return null;
  if (isDirectPath(pathname)) return null;
  if (headerValue && constantTimeEqual(headerValue, secret)) return null;
  return `${hubUrl.replace(/\/+$/, "")}${HUB_MOUNT}${pathname}${search}`;
}

export default function middleware(request) {
  const url = new URL(request.url);
  const target = hubRedirectTarget({
    pathname: url.pathname,
    search: url.search,
    headerValue: request.headers.get(HUB_HEADER),
    secret: process.env.FOCUS_REALM_HUB_SECRET?.trim(),
    hubUrl: process.env.FOCUS_REALM_HUB_URL?.trim(),
  });
  return target ? Response.redirect(target, 308) : next();
}
