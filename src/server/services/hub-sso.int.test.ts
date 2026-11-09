// Signing in through the Focus Realm Workspace (hub mode), end to end over HTTP against the test database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Hub mode is read from the environment when config loads, so set it before importing the app
const SECRET = "integration-hub-secret-".padEnd(64, "h");
const HUB = "https://hub.focusrealm.test";
const HUB_ENV = { FOCUS_REALM_HUB_SECRET: SECRET, FOCUS_REALM_HUB_URL: HUB, VITE_BASE_PATH: "/mail/" } as const;
const previousEnv = Object.fromEntries(Object.keys(HUB_ENV).map((k) => [k, process.env[k]]));
Object.assign(process.env, HUB_ENV);

type Db = typeof import("../db.js").default;
let prisma: Db;
let sign: typeof import("./hub-service.js").signHubTicket;
let hashPassword: typeof import("./auth-service.js").hashPassword;
let server: Server;
let base: string;

beforeAll(async () => {
  prisma = (await import("../db.js")).default;
  sign = (await import("./hub-service.js")).signHubTicket;
  hashPassword = (await import("./auth-service.js")).hashPassword;
  const { createApp } = await import("../app.js");
  server = createApp().listen(0);
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  server?.close();
  await prisma?.$disconnect();
  for (const [k, v] of Object.entries(previousEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE used_hub_tickets, audit_logs, sessions, auth_tokens, users CASCADE`);
});

const now = () => Math.floor(Date.now() / 1000);
const ticket = (over: Record<string, unknown> = {}) =>
  sign(SECRET, { v: 1, app: "mail", sub: "fr-0042", name: "Priya Menon", role: "EMPLOYEE", email: "priya@focusrealm.test", iat: now(), exp: now() + 60, ...over });

/** A request as the Workspace forwards it (with the hub header), unless `direct` */
function call(path: string, opts: { method?: string; body?: unknown; cookie?: string; accept?: string; direct?: boolean } = {}) {
  return fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    redirect: "manual",
    headers: {
      accept: opts.accept ?? "application/json",
      ...(opts.direct ? {} : { "x-focusrealm-hub": SECRET }),
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

const signIn = (t: string, accept?: string) => call(`/api/auth/hub?launch=${encodeURIComponent(t)}`, { accept });
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
async function errorOf(res: Response) {
  const body = (await res.json()) as { error: { code: string; details?: { reason?: string } } };
  return { status: res.status, code: body.error.code, reason: body.error.details?.reason };
}

describe("signing in through the Workspace", () => {
  it("creates an employee account on first sign-in, with a 12-hour session cookie scoped to /mail", async () => {
    const res = await signIn(ticket());
    expect(res.status).toBe(200);
    const { data } = (await res.json()) as { data: { employeeCode: string; role: string; email: string; name: string } };
    expect(data).toMatchObject({ employeeCode: "FR-0042", role: "EMPLOYEE", email: "priya@focusrealm.test", name: "Priya Menon" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^fr_mail_session=/);
    expect(setCookie).toContain("Path=/mail");
    expect(setCookie).toContain("HttpOnly");
    const expires = new Date(/Expires=([^;]+)/.exec(setCookie)![1]!).getTime();
    expect(Math.abs(expires - (Date.now() + 12 * 3600_000))).toBeLessThan(60_000);

    const me = await call("/api/auth/me", { cookie: cookieOf(res) });
    expect(me.status).toBe(200);
    expect(((await me.json()) as { data: { employeeCode: string } }).data.employeeCode).toBe("FR-0042");

    const actions = (await prisma.auditLog.findMany({ select: { action: true } })).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["hub.user_created", "auth.hub_login"]));
  });

  it("makes Workspace founders founders", async () => {
    const res = await signIn(ticket({ sub: "FR-0001", role: "FOUNDER" }));
    expect(((await res.json()) as { data: { role: string } }).data.role).toBe("FOUNDER");
  });

  it("updates an existing account's name and role, and signs out its other sessions on a role change", async () => {
    await prisma.user.create({ data: { employeeCode: "FR-0001", name: "Other Founder", role: "FOUNDER", status: "ACTIVE" } });
    const first = await signIn(ticket({ name: "Priya M" }));
    const oldCookie = cookieOf(first);

    const promoted = await signIn(ticket({ name: "Priya Menon", role: "FOUNDER" }));
    expect(((await promoted.json()) as { data: { role: string; name: string } }).data).toMatchObject({ role: "FOUNDER", name: "Priya Menon" });
    expect((await call("/api/auth/me", { cookie: oldCookie })).status).toBe(401);

    const demoted = await signIn(ticket({ role: "MANAGER" }));
    expect(((await demoted.json()) as { data: { role: string } }).data.role).toBe("EMPLOYEE");
    expect(await prisma.user.count({ where: { employeeCode: "FR-0042" } })).toBe(1);
  });

  it("never demotes the last active founder", async () => {
    await prisma.user.create({ data: { employeeCode: "FR-0042", name: "Priya Menon", role: "FOUNDER", status: "ACTIVE" } });
    const res = await signIn(ticket({ role: "EMPLOYEE" }));
    expect(res.status).toBe(200);
    expect(((await res.json()) as { data: { role: string } }).data.role).toBe("FOUNDER");
    expect(await prisma.auditLog.count({ where: { action: "hub.kept_last_founder" } })).toBe(1);
  });

  it("refuses a disabled account, as JSON and as a page", async () => {
    await prisma.user.create({ data: { employeeCode: "FR-0042", name: "Priya Menon", role: "EMPLOYEE", status: "DISABLED" } });
    expect(await errorOf(await signIn(ticket()))).toMatchObject({ status: 403, code: "ACCESS_DISABLED" });

    const page = await signIn(ticket({ iat: now() - 1 }), "text/html");
    expect(page.status).toBe(403);
    expect(await page.text()).toContain("Your Mail Merge access was switched off. Ask a founder.");
    expect(page.headers.get("set-cookie")).toBeNull();
  });

  it("matches accounts by employee ID only, never by email", async () => {
    const existing = await prisma.user.create({ data: { email: "priya@focusrealm.test", name: "Shared Mailbox", role: "FOUNDER", status: "ACTIVE" } });
    const res = await signIn(ticket());
    const { data } = (await res.json()) as { data: { id: string; email: string | null; role: string } };
    expect(data.id).not.toBe(existing.id);
    expect(data).toMatchObject({ email: null, role: "EMPLOYEE" });
    expect(await prisma.user.findUniqueOrThrow({ where: { id: existing.id } })).toMatchObject({ name: "Shared Mailbox", employeeCode: null });
  });

  it("redirects a browser that opens the link directly into the app", async () => {
    const res = await signIn(ticket(), "text/html");
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/mail/");
  });
});

describe("launch tickets", () => {
  it("work once", async () => {
    const t = ticket();
    expect((await signIn(t)).status).toBe(200);
    expect(await errorOf(await signIn(t))).toEqual({ status: 401, code: "HUB_TICKET_INVALID", reason: "reused" });
  });

  it("let a double click through when the first one already signed this browser in", async () => {
    const t = ticket();
    const cookie = cookieOf(await signIn(t));
    const again = await call(`/api/auth/hub?launch=${encodeURIComponent(t)}`, { cookie });
    expect(again.status).toBe(200);
    expect(again.headers.get("set-cookie")).toBeNull();
    // …but not for someone else's session
    const other = cookieOf(await signIn(ticket({ sub: "FR-0099", iat: now() - 1 })));
    expect(await errorOf(await call(`/api/auth/hub?launch=${encodeURIComponent(t)}`, { cookie: other }))).toMatchObject({ status: 401, reason: "reused" });
  });

  it.each([
    ["wrong_app", { app: "crm" }],
    ["expired", { iat: now() - 90, exp: now() - 30 }],
    ["not_yet_valid", { iat: now() + 120, exp: now() + 180 }],
  ])("are refused when %s", async (reason, over) => {
    expect(await errorOf(await signIn(ticket(over)))).toEqual({ status: 401, code: "HUB_TICKET_INVALID", reason });
    expect(await prisma.user.count()).toBe(0);
  });

  it("are refused with a bad signature", async () => {
    const forged = sign("another-secret".padEnd(64, "z"), { v: 1, app: "mail", sub: "FR-0001", name: "Mallory", role: "FOUNDER", iat: now(), exp: now() + 60 });
    expect(await errorOf(await signIn(forged))).toEqual({ status: 401, code: "HUB_TICKET_INVALID", reason: "bad_signature" });
    expect(await prisma.user.count()).toBe(0);
  });
});

describe("hub mode", () => {
  it("reports how to sign in", async () => {
    const res = await call("/api/auth/mode");
    expect(((await res.json()) as { data: unknown }).data).toEqual({ hub: true, hubUrl: HUB, passwordLogin: false, simple: false });
  });

  it("sends requests that skip the hub to the same address on the hub", async () => {
    const res = await call("/api/auth/me?x=1", { direct: true });
    expect(res.status).toBe(308);
    expect(res.headers.get("location")).toBe(`${HUB}/mail/api/auth/me?x=1`);
  });

  it("still answers cron ticks, unsubscribe links and health checks directly", async () => {
    expect((await call("/health", { direct: true })).status).toBe(200);
    expect((await call("/api/internal/tick", { direct: true })).status).not.toBe(308);
    expect((await call("/u/not-a-real-token", { direct: true, accept: "text/html" })).status).toBe(404);
  });

  it("turns off password sign-in, invites and password resets", async () => {
    await prisma.user.create({ data: { email: "f@focusrealm.test", name: "Fay", role: "FOUNDER", status: "ACTIVE", passwordHash: await hashPassword("founder-password-1") } });
    expect(await errorOf(await call("/api/auth/login", { method: "POST", body: { email: "f@focusrealm.test", password: "founder-password-1" } }))).toMatchObject({ status: 403, code: "HUB_SIGN_IN" });
    expect(await errorOf(await call("/api/auth/invite/anything"))).toMatchObject({ status: 403, code: "HUB_SIGN_IN" });
    expect(await errorOf(await call("/api/auth/accept-invite", { method: "POST", body: { token: "x", name: "X", password: "long-enough-password" } }))).toMatchObject({ status: 403, code: "HUB_SIGN_IN" });
    expect(await errorOf(await call("/api/auth/reset-password", { method: "POST", body: { token: "x", password: "long-enough-password" } }))).toMatchObject({ status: 403, code: "HUB_SIGN_IN" });

    const founder = await signIn(ticket({ sub: "FR-0001", role: "FOUNDER" }));
    const cookie = cookieOf(founder);
    expect(await errorOf(await call("/api/users/invite", { method: "POST", cookie, body: { email: "new@focusrealm.test", name: "New", role: "EMPLOYEE", sendEmail: false } }))).toMatchObject({ status: 403, code: "HUB_MANAGED" });
  });

  it("lists each member's employee ID for founders", async () => {
    const cookie = cookieOf(await signIn(ticket({ sub: "FR-0001", role: "FOUNDER", name: "Fay" })));
    await signIn(ticket());
    const res = await call("/api/users", { cookie });
    const members = ((await res.json()) as { data: { employeeCode: string | null }[] }).data.map((m) => m.employeeCode).sort();
    expect(members).toEqual(["FR-0001", "FR-0042"]);
  });
});
