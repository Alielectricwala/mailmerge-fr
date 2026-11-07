import { describe, it, expect } from "vitest";
// hubRedirectTarget is tested in tests/hub-redirect.test.ts, next to its edge copy (middleware.js)
import { constantTimeEqual, isDirectPath, normalizeBasePath } from "./hub.js";

describe("normalizeBasePath", () => {
  it.each([
    [undefined, "/"],
    ["", "/"],
    ["/", "/"],
    ["mail", "/mail/"],
    ["/mail", "/mail/"],
    ["/mail/", "/mail/"],
    [" //mail// ", "/mail/"],
  ])("%j → %s", (input, expected) => expect(normalizeBasePath(input)).toBe(expected));
});

describe("isDirectPath", () => {
  it("lets cron, unsubscribe links and health checks reach this app directly", () => {
    expect(isDirectPath("/api/internal/tick")).toBe(true);
    expect(isDirectPath("/u/abc123")).toBe(true);
    expect(isDirectPath("/health")).toBe(true);
  });
  it("sends everything else through the hub", () => {
    for (const p of ["/", "/campaigns", "/api/auth/me", "/api/internal", "/assets/index.js", "/user", "/healthz"]) expect(isDirectPath(p)).toBe(false);
  });
});

describe("constantTimeEqual", () => {
  it("compares strings exactly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "abcd")).toBe(false);
    expect(constantTimeEqual("", "a")).toBe(false);
  });
});
