// The hub redirect rule exists twice: src/shared/hub.ts (Express, for the API) and middleware.js
// (Vercel Routing Middleware, a self-contained copy that also covers static pages). Both must agree.
import { describe, it, expect } from "vitest";
import { hubRedirectTarget } from "../src/shared/hub.js";
import middleware, { hubRedirectTarget as edgeHubRedirectTarget } from "../middleware.js";

const SECRET = "s".repeat(64);
const HUB = "https://employee-management.vercel.app";

const CASES: {
  name: string;
  input: { pathname: string; search: string; headerValue: string | null; secret: string | undefined; hubUrl: string | undefined };
  expected: string | null;
}[] = [
  { name: "hub mode off: no secret", input: { pathname: "/campaigns", search: "", headerValue: null, secret: undefined, hubUrl: HUB }, expected: null },
  { name: "hub mode off: no hub URL", input: { pathname: "/campaigns", search: "", headerValue: null, secret: SECRET, hubUrl: undefined }, expected: null },
  { name: "came through the hub", input: { pathname: "/campaigns", search: "?a=1", headerValue: SECRET, secret: SECRET, hubUrl: HUB }, expected: null },
  { name: "direct visit to a page", input: { pathname: "/campaigns", search: "?a=1", headerValue: null, secret: SECRET, hubUrl: HUB }, expected: `${HUB}/mail/campaigns?a=1` },
  { name: "wrong header value", input: { pathname: "/api/auth/me", search: "", headerValue: "guess", secret: SECRET, hubUrl: HUB }, expected: `${HUB}/mail/api/auth/me` },
  { name: "hub URL with a trailing slash", input: { pathname: "/", search: "", headerValue: null, secret: SECRET, hubUrl: `${HUB}/` }, expected: `${HUB}/mail/` },
  { name: "cron tick", input: { pathname: "/api/internal/tick", search: "", headerValue: null, secret: SECRET, hubUrl: HUB }, expected: null },
  { name: "unsubscribe link", input: { pathname: "/u/token", search: "", headerValue: null, secret: SECRET, hubUrl: HUB }, expected: null },
  { name: "health check", input: { pathname: "/health", search: "", headerValue: null, secret: SECRET, hubUrl: HUB }, expected: null },
];

describe("hubRedirectTarget", () => {
  it.each(CASES)("$name", ({ input, expected }) => expect(hubRedirectTarget(input)).toBe(expected));
  it.each(CASES)("middleware.js agrees: $name", ({ input, expected }) => expect(edgeHubRedirectTarget(input)).toBe(expected));
});

describe("middleware.js", () => {
  it("redirects a direct visit with 308 when hub mode is on", () => {
    process.env.FOCUS_REALM_HUB_SECRET = "s".repeat(64);
    process.env.FOCUS_REALM_HUB_URL = "https://hub.example";
    try {
      const res = middleware(new Request("https://fr-mailer.vercel.app/campaigns?x=1"));
      expect(res.status).toBe(308);
      expect(res.headers.get("location")).toBe("https://hub.example/mail/campaigns?x=1");
      const passed = middleware(new Request("https://fr-mailer.vercel.app/campaigns", { headers: { "x-focusrealm-hub": "s".repeat(64) } }));
      expect(passed.headers.get("x-middleware-next")).toBe("1");
    } finally {
      delete process.env.FOCUS_REALM_HUB_SECRET;
      delete process.env.FOCUS_REALM_HUB_URL;
    }
  });

  it("never redirects while SIMPLE_SIGNIN is on, even with the hub configured", () => {
    process.env.FOCUS_REALM_HUB_SECRET = "s".repeat(64);
    process.env.FOCUS_REALM_HUB_URL = "https://hub.example";
    process.env.SIMPLE_SIGNIN = "true";
    try {
      const res = middleware(new Request("https://fr-mailer.vercel.app/campaigns?x=1"));
      expect(res.headers.get("x-middleware-next")).toBe("1");
      expect(res.headers.get("location")).toBeNull();
    } finally {
      delete process.env.FOCUS_REALM_HUB_SECRET;
      delete process.env.FOCUS_REALM_HUB_URL;
      delete process.env.SIMPLE_SIGNIN;
    }
  });
});
