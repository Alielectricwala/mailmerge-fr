// Simple sign-in (SIMPLE_SIGNIN=true): name + FR ID, end to end over HTTP against the test database.
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "http";
import type { AddressInfo } from "net";

// Read when config loads, so set before importing the app. The hub is configured too, to prove simple
// sign-in turns it off.
const SIMPLE_ENV = {
  SIMPLE_SIGNIN: "true",
  FOUNDER_EMPLOYEE_CODES: " fr-0001 , FR-0002",
  FOCUS_REALM_HUB_SECRET: "integration-hub-secret-".padEnd(64, "h"),
  FOCUS_REALM_HUB_URL: "https://hub.focusrealm.test",
  VITE_BASE_PATH: "/mail/",
  CRON_SECRET: "integration-cron-secret",
} as const;
const previousEnv = Object.fromEntries(Object.keys(SIMPLE_ENV).map((k) => [k, process.env[k]]));
Object.assign(process.env, SIMPLE_ENV);

type Db = typeof import("../db.js").default;
let prisma: Db;
let resetAttempts: () => void;
let server: Server;
let base: string;

beforeAll(async () => {
  prisma = (await import("../db.js")).default;
  resetAttempts = (await import("./simple-signin-service.js")).resetSimpleSignInAttempts;
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
  resetAttempts();
  await prisma.$executeRawUnsafe(`TRUNCATE templates, contacts, audit_logs, sessions, auth_tokens, users CASCADE`);
});

function call(path: string, opts: { method?: string; body?: unknown; cookie?: string; accept?: string; headers?: Record<string, string> } = {}) {
  return fetch(`${base}${path}`, {
    method: opts.method ?? "GET",
    redirect: "manual",
    headers: {
      accept: opts.accept ?? "application/json",
      "user-agent": "simple-signin-test",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
      ...(opts.body ? { "content-type": "application/json" } : {}),
      ...opts.headers,
    },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
}

const signIn = (name: string, employeeCode: string) => call("/api/auth/simple", { method: "POST", body: { name, employeeCode } });
const cookieOf = (res: Response) => res.headers.get("set-cookie")?.split(";")[0] ?? "";
const dataOf = async <T>(res: Response) => ((await res.json()) as { data: T }).data;
async function errorOf(res: Response) {
  const body = (await res.json()) as { error: { code: string; message: string } };
  return { status: res.status, code: body.error.code, message: body.error.message };
}

describe("simple sign-in", () => {
  it("creates an employee on first sign-in, with no email, and a 12-hour session cookie", async () => {
    const res = await signIn("  Priya Menon ", " fr-0042 ");
    expect(res.status).toBe(200);
    expect(await dataOf(res)).toMatchObject({ employeeCode: "FR-0042", name: "Priya Menon", role: "EMPLOYEE", email: null, status: "ACTIVE" });

    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toMatch(/^fr_session=/);
    expect(setCookie).toContain("Path=/;");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    const expires = new Date(/Expires=([^;]+)/.exec(setCookie)![1]!).getTime();
    expect(Math.abs(expires - (Date.now() + 12 * 3600_000))).toBeLessThan(60_000);

    const me = await call("/api/auth/me", { cookie: cookieOf(res) });
    expect(me.status).toBe(200);
  });

  it("makes FR IDs in FOUNDER_EMPLOYEE_CODES founders", async () => {
    expect(await dataOf(await signIn("Sehej Sharma", "FR-0001"))).toMatchObject({ role: "FOUNDER" });
    expect(await dataOf(await signIn("Second Founder", "fr-0002"))).toMatchObject({ role: "FOUNDER" });
  });

  it("keeps the stored name for an existing FR ID and records the typed one", async () => {
    await signIn("Priya Menon", "FR-0042");
    const again = await signIn("Somebody Else", "FR-0042");
    expect(await dataOf(again)).toMatchObject({ name: "Priya Menon" });
    expect(await prisma.user.count()).toBe(1);

    const logins = await prisma.auditLog.findMany({ where: { action: "auth.simple_login" }, orderBy: { createdAt: "asc" } });
    expect(logins.map((l) => (l.metadata as { typedName: string }).typedName)).toEqual(["Priya Menon", "Somebody Else"]);
    expect(logins[1]).toMatchObject({ ipAddress: expect.any(String), userAgent: "simple-signin-test" });
    expect(logins[1]!.metadata).toMatchObject({ employeeCode: "FR-0042", storedName: "Priya Menon", userAgent: "simple-signin-test" });
  });

  it("refuses a disabled account", async () => {
    await prisma.user.create({ data: { employeeCode: "FR-0042", name: "Priya Menon", role: "EMPLOYEE", status: "DISABLED" } });
    expect(await errorOf(await signIn("Priya Menon", "FR-0042"))).toEqual({
      status: 403,
      code: "ACCESS_DISABLED",
      message: "Your Mail Merge access was switched off. Ask a founder.",
    });
  });

  it("refuses a malformed FR ID or a missing name", async () => {
    expect((await signIn("Priya", "0042")).status).toBe(400);
    expect((await signIn("Priya", "LG-0001")).status).toBe(400);
    expect((await signIn("  ", "FR-0042")).status).toBe(400);
    expect(await prisma.user.count()).toBe(0);
  });

  it("rate-limits sign-in attempts per IP", async () => {
    for (let i = 0; i < 30; i++) await signIn("Priya", "FR-0042");
    const limited = await signIn("Priya", "FR-0042");
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("signs out, ends the session and records it", async () => {
    const cookie = cookieOf(await signIn("Priya Menon", "FR-0042"));
    expect((await call("/api/auth/logout", { method: "POST", cookie })).status).toBe(200);
    expect((await call("/api/auth/me", { cookie })).status).toBe(401);
    const logout = await prisma.auditLog.findFirstOrThrow({ where: { action: "auth.logout" } });
    expect(logout.metadata).toMatchObject({ employeeCode: "FR-0042", typedName: "Priya Menon" });
  });

  it("reports the mode, with passwords and the hub off", async () => {
    expect(await dataOf(await call("/api/auth/mode"))).toEqual({ hub: false, hubUrl: null, passwordLogin: false, simple: true });
  });
});

describe("what simple sign-in turns off", () => {
  it("password sign-in, invites, resets and password changes", async () => {
    const founder = cookieOf(await signIn("Sehej Sharma", "FR-0001"));
    for (const [path, method, body] of [
      ["/api/auth/login", "POST", { email: "f@focusrealm.test", password: "anything-long" }],
      ["/api/auth/invite/anything", "GET", undefined],
      ["/api/auth/accept-invite", "POST", { token: "x", name: "X", password: "long-enough-password" }],
      ["/api/auth/reset-password", "POST", { token: "x", password: "long-enough-password" }],
      ["/api/auth/password", "POST", { currentPassword: "x", newPassword: "long-enough-password" }],
      ["/api/users/invite", "POST", { email: "new@focusrealm.test", name: "New", role: "EMPLOYEE", sendEmail: false }],
    ] as const) {
      expect(await errorOf(await call(path, { method, body, cookie: founder })), path).toMatchObject({ status: 403, code: "SIMPLE_SIGNIN" });
    }
  });

  it("role changes from the Team page (roles come from FOUNDER_EMPLOYEE_CODES), but not disabling", async () => {
    const founder = cookieOf(await signIn("Sehej Sharma", "FR-0001"));
    const employee = await dataOf<{ id: string }>(await signIn("Priya Menon", "FR-0042"));
    expect(await errorOf(await call(`/api/users/${employee.id}`, { method: "PATCH", cookie: founder, body: { role: "FOUNDER" } }))).toMatchObject({ status: 403, code: "SIMPLE_SIGNIN_ROLES" });
    expect((await call(`/api/users/${employee.id}`, { method: "PATCH", cookie: founder, body: { status: "DISABLED" } })).status).toBe(200);
    expect((await signIn("Priya Menon", "FR-0042")).status).toBe(403);
  });

  it("the hub redirect: the app answers at its own address", async () => {
    expect((await call("/api/auth/mode")).status).toBe(200);
    expect((await call("/api/auth/hub?launch=x")).status).toBe(404);
  });
});

describe("what stays the same", () => {
  it("/api/internal/tick still needs CRON_SECRET", async () => {
    expect((await call("/api/internal/tick")).status).toBe(401);
    expect((await call("/api/internal/tick", { headers: { authorization: "Bearer wrong" } })).status).toBe(401);
    expect((await call("/api/internal/tick", { headers: { authorization: `Bearer ${SIMPLE_ENV.CRON_SECRET}` } })).status).toBe(200);
  });

  it("/health and unsubscribe links work without signing in", async () => {
    expect((await call("/health")).status).toBe(200);
    expect((await call("/u/not-a-real-token", { accept: "text/html" })).status).toBe(404);
  });

  it("employees can't change settings or live sending", async () => {
    const employee = cookieOf(await signIn("Priya Menon", "FR-0042"));
    expect((await call("/api/mailbox/live-sending", { method: "POST", cookie: employee, body: { enabled: true } })).status).toBe(403);
    expect((await call("/api/mailbox/update-account", { method: "POST", cookie: employee, body: { email: "x@focusrealm.test", password: "p" } })).status).toBe(403);
    expect((await call("/api/activity", { cookie: employee })).status).toBe(403);
  });
});

describe("Activity", () => {
  it("attributes actions to the signed-in person, shows FR IDs, and filters by person", async () => {
    const founder = cookieOf(await signIn("Sehej Sharma", "FR-0001"));
    const priya = await signIn("Priya Menon", "FR-0042");
    const priyaId = (await dataOf<{ id: string }>(priya)).id;
    const cookie = cookieOf(priya);

    const template = await dataOf<{ id: string }>(await call("/api/templates", { method: "POST", cookie, body: { name: "Intro", subject: "Hi {{firstName}}", bodyHtml: "<p>Hello</p>" } }));
    expect((await call("/api/contacts", { method: "POST", cookie, body: { email: "ana@hotel-a.com", firstName: "Ana" } })).status).toBe(201);
    expect((await call(`/api/templates/${template.id}`, { method: "DELETE", cookie })).status).toBe(200);
    expect((await call("/api/auth/me", { method: "PATCH", cookie, body: { senderName: "Priya" } })).status).toBe(200);

    for (const action of ["template.create", "contact.create", "template.delete", "account.update_profile"]) {
      expect(await prisma.auditLog.findFirst({ where: { action } }), action).toMatchObject({ userId: priyaId });
    }

    type Row = { action: string; summary: string; user: { name: string; employeeCode: string } | null; ipAddress: string | null };
    const all = await dataOf<Row[]>(await call("/api/activity", { cookie: founder }));
    expect(all.some((r) => r.action === "auth.simple_login" && r.user?.employeeCode === "FR-0001")).toBe(true);
    const signInRow = all.find((r) => r.action === "auth.simple_login" && r.user?.employeeCode === "FR-0042")!;
    expect(signInRow.summary).toContain("“Priya Menon” (FR-0042)");
    expect(signInRow.ipAddress).toBeTruthy();

    const onlyPriya = await dataOf<Row[]>(await call(`/api/activity?userId=${priyaId}`, { cookie: founder }));
    expect(onlyPriya.length).toBeGreaterThan(0);
    expect(onlyPriya.every((r) => r.user?.employeeCode === "FR-0042")).toBe(true);
  });
});
