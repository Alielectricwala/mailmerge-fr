import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { HubTicketError, mapHubRole, passwordSignInAllowed, signHubTicket, verifyHubTicket, type HubTicketProblem } from "./hub-service.js";

const SECRET = "hub-secret-".padEnd(64, "x");
const NOW = 1_800_000_000;
const payload = (over: Record<string, unknown> = {}) => ({
  v: 1,
  app: "mail",
  sub: "fr-0042",
  name: "Priya Menon",
  role: "EMPLOYEE",
  email: "priya@focusrealm.com",
  iat: NOW,
  exp: NOW + 60,
  ...over,
});

function problem(ticket: string, now = NOW): HubTicketProblem | "ok" {
  try {
    verifyHubTicket(ticket, SECRET, now);
    return "ok";
  } catch (err) {
    if (err instanceof HubTicketError) return err.problem;
    throw err;
  }
}

describe("verifyHubTicket", () => {
  it("accepts a ticket signed the way the Workspace signs it", () => {
    // Built by hand from the Workspace's format (src/lib/hub/ticket.ts), not with signHubTicket
    const body = Buffer.from(JSON.stringify(payload()), "utf8").toString("base64url");
    const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
    const verified = verifyHubTicket(`${body}.${sig}`, SECRET, NOW);
    expect(verified).toMatchObject({ sub: "fr-0042", name: "Priya Menon", role: "EMPLOYEE", email: "priya@focusrealm.com" });
  });

  it("rejects a ticket for another app", () => expect(problem(signHubTicket(SECRET, payload({ app: "crm" })))).toBe("wrong_app"));
  it("rejects an expired ticket", () => expect(problem(signHubTicket(SECRET, payload({ iat: NOW - 120, exp: NOW - 1 })))).toBe("expired"));
  it("rejects a ticket that expires exactly now", () => expect(problem(signHubTicket(SECRET, payload({ exp: NOW })))).toBe("expired"));
  it("rejects a ticket issued more than 30 seconds in the future", () => expect(problem(signHubTicket(SECRET, payload({ iat: NOW + 31, exp: NOW + 90 })))).toBe("not_yet_valid"));
  it("tolerates 30 seconds of clock skew", () => expect(problem(signHubTicket(SECRET, payload({ iat: NOW + 30, exp: NOW + 90 })))).toBe("ok"));
  it("rejects a ticket that lives longer than 2 minutes", () => expect(problem(signHubTicket(SECRET, payload({ exp: NOW + 121 })))).toBe("too_long_lived"));
  it("rejects a ticket signed with another secret", () => expect(problem(signHubTicket("another-secret".padEnd(64, "y"), payload()))).toBe("bad_signature"));

  it("rejects a ticket whose payload was changed after signing", () => {
    const [, sig] = signHubTicket(SECRET, payload()).split(".");
    const forged = Buffer.from(JSON.stringify(payload({ role: "FOUNDER" }))).toString("base64url");
    expect(problem(`${forged}.${sig}`)).toBe("bad_signature");
  });

  it("rejects malformed tickets", () => {
    expect(problem("")).toBe("malformed");
    expect(problem("no-dot")).toBe("malformed");
    expect(problem("a.b.c")).toBe("malformed");
    expect(problem(signHubTicket(SECRET, payload({ v: 2 })))).toBe("malformed");
    expect(problem(signHubTicket(SECRET, payload({ sub: "bad id!" })))).toBe("malformed");
    const notJson = Buffer.from("not json").toString("base64url");
    expect(problem(`${notJson}.${crypto.createHmac("sha256", SECRET).update(notJson).digest("base64url")}`)).toBe("malformed");
  });

  it("ignores a malformed email instead of refusing the ticket", () => {
    expect(verifyHubTicket(signHubTicket(SECRET, payload({ email: "not-an-email" })), SECRET, NOW).email).toBeUndefined();
  });
});

describe("mapHubRole", () => {
  it("keeps founders as founders", () => expect(mapHubRole("FOUNDER")).toBe("FOUNDER"));
  it.each(["EMPLOYEE", "MANAGER", "INTERN", "", "founder-ish"])("makes %j an employee", (role) => expect(mapHubRole(role)).toBe("EMPLOYEE"));
});

describe("passwordSignInAllowed", () => {
  it("allows everyone outside hub mode", () => {
    expect(passwordSignInAllowed({ hubMode: false, allowPasswordLogin: false, role: "EMPLOYEE" })).toBe(true);
  });
  it("allows no one in hub mode without the break-glass switch", () => {
    expect(passwordSignInAllowed({ hubMode: true, allowPasswordLogin: false, role: "FOUNDER" })).toBe(false);
  });
  it("allows only founders with the break-glass switch", () => {
    expect(passwordSignInAllowed({ hubMode: true, allowPasswordLogin: true, role: "FOUNDER" })).toBe(true);
    expect(passwordSignInAllowed({ hubMode: true, allowPasswordLogin: true, role: "EMPLOYEE" })).toBe(false);
  });
});
