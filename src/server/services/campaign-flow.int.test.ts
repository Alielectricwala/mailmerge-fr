// End-to-end campaign flow against a real (test) database with a fake mail transport.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import type { AddressInfo } from "net";
import prisma from "../db.js";
import { createApp } from "../app.js";
import { setTransport, type MailTransport, type OutgoingMessage } from "./mailer.js";
import { approveCampaign, cancelCampaign, pauseCampaign, requestApproval, resolveUnknown, reviewCampaign, sendTest, startCampaign } from "./campaign-service.js";
import { acquireLease, recoverInterruptedSends, releaseLease, sendOne, SendWorker } from "./send-worker.js";
import { unsubscribeToken } from "./unsubscribe.js";
import { hashPassword } from "./auth-service.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

class FakeTransport implements MailTransport {
  sent: OutgoingMessage[] = [];
  failWith: ((m: OutgoingMessage) => unknown) | null = null;
  async send(message: OutgoingMessage) {
    await new Promise((r) => setTimeout(r, 5)); // widen race windows
    const err = this.failWith?.(message);
    if (err) throw err;
    this.sent.push(message);
    return { response: "250 OK" };
  }
  async verify() {}
  close() {}
}

let transport: FakeTransport;
const fakeReq = (user: { id: string; name: string; role: "FOUNDER" | "EMPLOYEE" }) =>
  ({ user: { ...user, email: `${user.id}@focusrealm.test`, status: "ACTIVE" }, ip: "127.0.0.1", get: () => "vitest" }) as unknown as Request;

async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE send_events, sends, campaigns, campaign_members, import_batches, contact_lists, enrichments, contacts, templates, suppression_entries, audit_logs, sessions, auth_tokens, users, settings CASCADE`
  );
}

async function seed() {
  const founder = await prisma.user.create({ data: { email: "f@focusrealm.test", name: "Fay Founder", role: "FOUNDER", status: "ACTIVE", passwordHash: await hashPassword("founder-password-1") } });
  const employee = await prisma.user.create({ data: { email: "e@focusrealm.test", name: "Eli Employee", role: "EMPLOYEE", status: "ACTIVE" } });
  const list = await prisma.contactList.create({ data: { name: "Hotels" } });
  const contacts = await Promise.all(
    [
      { email: "ana@hotel-a.com", firstName: "Ana", company: "Hotel A" },
      { email: "ben@hotel-b.com", firstName: "Ben", company: "Hotel B" },
      { email: "cy@hotel-c.com", firstName: "Cy", company: "<b>Hotel C</b>" },
      { email: "dee@nocompany.com", firstName: "Dee" }, // missing required {{company}}
      { email: "out@hotel-e.com", firstName: "Eve", company: "Hotel E" }, // suppressed
    ].map((c) => prisma.contact.create({ data: c }))
  );
  await prisma.listMembership.createMany({ data: contacts.map((c) => ({ contactId: c.id, contactListId: list.id })) });
  await prisma.suppressionEntry.create({ data: { email: "out@hotel-e.com", reason: "UNSUBSCRIBE", source: "test" } });
  const template = await prisma.template.create({
    data: { name: "Intro", subject: "Hi {{firstName}}, a note for {{company}}", bodyHtml: "<p>Hello {{firstName|there}} at {{company}}</p>" },
  });
  const campaign = await prisma.campaign.create({
    data: { name: "Launch", templateId: template.id, contactListId: list.id, fromName: "FocusRealm", sendRatePerMinute: 120, createdById: employee.id },
  });
  return {
    founderReq: fakeReq({ id: founder.id, name: founder.name, role: "FOUNDER" }),
    employeeReq: fakeReq({ id: employee.id, name: employee.name, role: "EMPLOYEE" }),
    campaign,
    template,
  };
}

async function approveAndStart(f: Awaited<ReturnType<typeof seed>>) {
  await requestApproval(f.employeeReq, f.campaign.id);
  const review = await reviewCampaign(f.campaign.id);
  await approveCampaign(f.founderReq, f.campaign.id, { contentHash: review.contentHash, ready: review.ready });
  await startCampaign(f.founderReq, f.campaign.id);
}

async function drain(campaignId: string) {
  const c = await prisma.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  for (let i = 0; i < 50 && (await sendOne(c)); i++);
}

beforeEach(async () => {
  await resetDb();
  transport = new FakeTransport();
  setTransport(transport);
});

afterAll(async () => {
  setTransport(null);
  await prisma.$disconnect();
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("review & approval", () => {
  it("reports ready, missing-data and suppressed recipients", async () => {
    const f = await seed();
    const review = await reviewCampaign(f.campaign.id);
    expect(review).toMatchObject({ total: 5, ready: 3, issueCount: 2, templateErrors: [] });
    expect(review.missingFields).toEqual([expect.objectContaining({ email: "dee@nocompany.com", fields: ["company"] })]);
    expect(review.suppressed).toEqual([expect.objectContaining({ email: "out@hotel-e.com" })]);
  });

  it("rejects an approval based on a stale review", async () => {
    const f = await seed();
    await requestApproval(f.employeeReq, f.campaign.id);
    const review = await reviewCampaign(f.campaign.id);
    await prisma.template.update({ where: { id: f.template.id }, data: { subject: "Changed {{firstName}} {{company}}" } });
    await expect(approveCampaign(f.founderReq, f.campaign.id, { contentHash: review.contentHash, ready: review.ready })).rejects.toThrow(/changed since you reviewed/);
  });

  it("freezes rendered content (escaped, with footer) so later template edits change nothing", async () => {
    const f = await seed();
    await requestApproval(f.employeeReq, f.campaign.id);
    const review = await reviewCampaign(f.campaign.id);
    await approveCampaign(f.founderReq, f.campaign.id, { contentHash: review.contentHash, ready: review.ready });

    const sends = await prisma.send.findMany({ where: { campaignId: f.campaign.id }, orderBy: { email: "asc" } });
    expect(sends.map((s) => [s.email, s.status])).toEqual([
      ["ana@hotel-a.com", "PENDING"],
      ["ben@hotel-b.com", "PENDING"],
      ["cy@hotel-c.com", "PENDING"],
      ["dee@nocompany.com", "SKIPPED"],
      ["out@hotel-e.com", "SKIPPED"],
    ]);
    const cy = sends.find((s) => s.email === "cy@hotel-c.com")!;
    expect(cy.html).toContain("&lt;b&gt;Hotel C&lt;/b&gt;");
    expect(cy.html).toContain(`/u/${unsubscribeToken(cy.id)}`);
    expect(cy.messageId).toBe(`<${cy.id}@focusrealm.test>`);

    await prisma.template.update({ where: { id: f.template.id }, data: { subject: "Totally different" } });
    await startCampaign(f.founderReq, f.campaign.id);
    await drain(f.campaign.id);
    expect(transport.sent.map((m) => m.subject).sort()).toEqual(["Hi Ana, a note for Hotel A", "Hi Ben, a note for Hotel B", "Hi Cy, a note for <b>Hotel C</b>"]);
  });
});

describe("sending", () => {
  it("sends each recipient exactly once, even with concurrent workers, then completes", async () => {
    const f = await seed();
    await approveAndStart(f);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    await Promise.all(Array.from({ length: 12 }, () => sendOne(c)));
    await drain(f.campaign.id);

    const recipients = transport.sent.map((m) => m.to).sort();
    expect(recipients).toEqual(["ana@hotel-a.com", "ben@hotel-b.com", "cy@hotel-c.com"]);
    expect(new Set(transport.sent.map((m) => m.messageId)).size).toBe(3);
    expect(transport.sent[0]!.headers?.["List-Unsubscribe-Post"]).toBe("List-Unsubscribe=One-Click");
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } })).status).toBe("COMPLETED");
  });

  it("refuses to start twice", async () => {
    const f = await seed();
    await approveAndStart(f);
    await expect(startCampaign(f.founderReq, f.campaign.id)).rejects.toThrow(/Only approved campaigns/);
  });

  it("skips a recipient suppressed after approval", async () => {
    const f = await seed();
    await approveAndStart(f);
    await prisma.suppressionEntry.create({ data: { email: "ben@hotel-b.com", reason: "MANUAL", source: "test" } });
    await drain(f.campaign.id);
    expect(transport.sent.map((m) => m.to)).not.toContain("ben@hotel-b.com");
    expect((await prisma.send.findFirstOrThrow({ where: { email: "ben@hotel-b.com" } })).skipReason).toBe("Suppressed after approval");
  });

  it("records a 550 rejection as failed and suppresses the address", async () => {
    const f = await seed();
    await approveAndStart(f);
    transport.failWith = (m) => (m.to === "ana@hotel-a.com" ? Object.assign(new Error("no such user"), { responseCode: 550, command: "RCPT TO", response: "550 5.1.1 no such user" }) : null);
    await drain(f.campaign.id);
    const ana = await prisma.send.findFirstOrThrow({ where: { email: "ana@hotel-a.com" } });
    expect(ana.status).toBe("FAILED");
    expect(ana.bouncedAt).not.toBeNull();
    expect(await prisma.suppressionEntry.findUnique({ where: { email: "ana@hotel-a.com" } })).toMatchObject({ reason: "HARD_BOUNCE" });
  });

  it("pauses the campaign and keeps the message queued when the mailbox sign-in fails", async () => {
    const f = await seed();
    await approveAndStart(f);
    transport.failWith = () => Object.assign(new Error("Invalid login"), { code: "EAUTH", command: "AUTH PLAIN" });
    await drain(f.campaign.id);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    expect(c.status).toBe("PAUSED");
    expect(c.pausedReason).toMatch(/sign in/);
    expect(await prisma.send.count({ where: { campaignId: c.id, status: "PENDING" } })).toBe(3);
    expect(transport.sent).toHaveLength(0);
  });

  it("marks a timeout mid-handoff UNKNOWN and never retries it automatically", async () => {
    const f = await seed();
    await approveAndStart(f);
    transport.failWith = (m) => (m.to === "ben@hotel-b.com" ? Object.assign(new Error("Timeout"), { code: "ETIMEDOUT", command: "DATA" }) : null);
    await drain(f.campaign.id);
    await drain(f.campaign.id);
    expect(transport.sent.map((m) => m.to).sort()).toEqual(["ana@hotel-a.com", "cy@hotel-c.com"]);
    const ben = await prisma.send.findFirstOrThrow({ where: { email: "ben@hotel-b.com" } });
    expect(ben.status).toBe("UNKNOWN");

    // A person decides to send it again
    transport.failWith = null;
    await resolveUnknown(f.founderReq, f.campaign.id, ben.id, "retry");
    await drain(f.campaign.id);
    expect(transport.sent.filter((m) => m.to === "ben@hotel-b.com")).toHaveLength(1);
  });

  it("turns messages left mid-handoff by a crash into UNKNOWN on startup", async () => {
    const f = await seed();
    await approveAndStart(f);
    const one = await prisma.send.findFirstOrThrow({ where: { campaignId: f.campaign.id, status: "PENDING" } });
    await prisma.send.update({ where: { id: one.id }, data: { status: "CLAIMED" } });
    expect(await recoverInterruptedSends()).toBe(1);
    expect((await prisma.send.findUniqueOrThrow({ where: { id: one.id } })).status).toBe("UNKNOWN");
  });

  it("stops on pause and cancels what wasn't sent", async () => {
    const f = await seed();
    await approveAndStart(f);
    const c = await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } });
    await sendOne(c);
    await pauseCampaign(f.founderReq, c.id);
    const worker = new SendWorker();
    expect(await worker.tick()).toBe("idle");
    await cancelCampaign(f.founderReq, c.id);
    expect(transport.sent).toHaveLength(1);
    expect(await prisma.send.count({ where: { campaignId: c.id, status: "CANCELLED" } })).toBe(2);
  });

  it("sends tests only to the given addresses and records no sends", async () => {
    const f = await seed();
    const result = await sendTest(f.employeeReq, f.campaign.id, ["qa@focusrealm.test"]);
    expect(result.results).toEqual([{ to: "qa@focusrealm.test", ok: true }]);
    expect(transport.sent).toHaveLength(1);
    expect(transport.sent[0]!.subject).toMatch(/^\[Test\] Hi Ana/);
    expect(await prisma.send.count()).toBe(0);
  });
});

describe("serverless bursts", () => {
  it("lets only one holder take the sender lease, and reclaims it after expiry", async () => {
    const a = await acquireLease("sender", 60_000);
    expect(a).toBeTruthy();
    expect(await acquireLease("sender", 60_000)).toBeNull();
    await releaseLease("sender", a!);
    const b = await acquireLease("sender", 1);
    expect(b).toBeTruthy();
    await new Promise((r) => setTimeout(r, 5));
    expect(await acquireLease("sender", 60_000)).toBeTruthy(); // expired lease taken over
  });

  it("only treats old claims as interrupted, so other instances' in-flight sends are untouched", async () => {
    const f = await seed();
    await approveAndStart(f);
    const [fresh, stale] = await prisma.send.findMany({ where: { campaignId: f.campaign.id, status: "PENDING" }, take: 2 });
    await prisma.send.update({ where: { id: fresh!.id }, data: { status: "CLAIMED", claimedAt: new Date() } });
    await prisma.send.update({ where: { id: stale!.id }, data: { status: "CLAIMED", claimedAt: new Date(Date.now() - 20 * 60_000) } });
    expect(await recoverInterruptedSends(15 * 60_000)).toBe(1);
    expect((await prisma.send.findUniqueOrThrow({ where: { id: fresh!.id } })).status).toBe("CLAIMED");
    expect((await prisma.send.findUniqueOrThrow({ where: { id: stale!.id } })).status).toBe("UNKNOWN");
  });

  it("a bounded burst sends everything once and completes the campaign", async () => {
    const f = await seed();
    await approveAndStart(f);
    const result = await new SendWorker().runFor(20_000);
    expect(result).toEqual({ handled: 3, stoppedBecause: "idle" });
    expect(transport.sent).toHaveLength(3);
    expect((await prisma.campaign.findUniqueOrThrow({ where: { id: f.campaign.id } })).status).toBe("COMPLETED");
  });
});

describe("unsubscribe pages", () => {
  it("confirms on GET, unsubscribes on POST, rejects forged links", async () => {
    const f = await seed();
    await approveAndStart(f);
    await drain(f.campaign.id);
    const ana = await prisma.send.findFirstOrThrow({ where: { email: "ana@hotel-a.com" } });

    const server = createApp().listen(0);
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    try {
      const token = unsubscribeToken(ana.id);
      const get = await fetch(`${base}/u/${token}`);
      expect(await get.text()).toContain("Unsubscribe?");
      expect(await prisma.suppressionEntry.findUnique({ where: { email: "ana@hotel-a.com" } })).toBeNull();

      const post = await fetch(`${base}/u/${token}`, { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: "List-Unsubscribe=One-Click" });
      expect(await post.text()).toContain("You're unsubscribed");
      expect(await prisma.suppressionEntry.findUnique({ where: { email: "ana@hotel-a.com" } })).toMatchObject({ reason: "UNSUBSCRIBE" });
      expect((await prisma.send.findUniqueOrThrow({ where: { id: ana.id } })).unsubscribedAt).not.toBeNull();

      const forged = await fetch(`${base}/u/${ana.id}.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA`);
      expect(forged.status).toBe(404);
    } finally {
      server.close();
    }
  });
});
