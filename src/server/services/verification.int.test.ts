import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import prisma from "../db.js";
import { parseWorkbook, selectSheet, suggestMapping, validateMapping, runImport } from "./contact-import.js";
import { selectTemplateForRecipient, type SelectionContext } from "./template-selection.js";
import { renderEmail, contactMergeData } from "../../shared/merge.js";
import {
  approveCampaign,
  buildReview,
  sendTest,
  PERMITTED_TEST_RECIPIENTS,
  isPermittedTestRecipient,
} from "./campaign-service.js";
import { getCampaignAnalytics, recordSendOutcome } from "./analytics-service.js";
import { setTransport, type MailTransport, type OutgoingMessage } from "./mailer.js";

class FakeTransport implements MailTransport {
  public sent: OutgoingMessage[] = [];
  async send(message: OutgoingMessage) {
    this.sent.push(message);
    return { response: "250 2.0.0 OK queued as fake-12345" };
  }
  async verify() {}
  close() {}
}

describe("FocusRealm Mail Merge Verification Suite", () => {
  let fakeTransport: FakeTransport;
  let testUser: { id: string; email: string; name: string; role: any };

  beforeEach(async () => {
    fakeTransport = new FakeTransport();
    setTransport(fakeTransport);
    testUser = await prisma.user.upsert({
      where: { email: "test-verifier@focusrealm.test" },
      update: {},
      create: {
        email: "test-verifier@focusrealm.test",
        name: "Test Verifier",
        role: "FOUNDER",
        status: "ACTIVE",
      },
    });
  });

  afterEach(() => {
    setTransport(null);
  });

  // =========================================================================
  // Step 2: Import & Classification Verification
  // =========================================================================
  it("Step 2: imports synthetic contacts, maps fields, validates errors, and assigns classifications", async () => {
    const csvPath = path.resolve(process.cwd(), "tests/fixtures/synthetic-hotels-contacts.csv");
    const buffer = fs.readFileSync(csvPath);

    const sheets = await parseWorkbook(buffer, "synthetic-hotels-contacts.csv");
    expect(sheets.length).toBe(1);
    const parsed = selectSheet(sheets);

    const mapping = suggestMapping(parsed.headers);
    expect(mapping["Email"]).toBe("email");
    expect(mapping["Company"]).toBe("company");
    expect(mapping["Job Title"]).toBe("title");
    expect(mapping["Hotel Segment"]).toBe("hotelSegment");
    expect(mapping["Contact Persona"]).toBe("contactPersona");

    const validated = validateMapping(mapping, parsed.headers);

    const list = await prisma.contactList.create({
      data: { name: `Verification Test List ${Date.now()}` },
    });

    const result = await runImport({
      fileName: "synthetic-hotels-contacts.csv",
      sheet: parsed,
      mapping: validated,
      policy: "skip",
      multiEmail: "first",
      fixes: {},
      listId: list.id,
    });

    // Invalid row (invalid-email-row) must be rejected
    expect(result.errors.length).toBeGreaterThan(0);
    expect(result.errors.some((e) => e.message.includes("valid email"))).toBe(true);

    // Duplicate row must be detected
    expect(result.unchanged + result.skipped).toBeGreaterThanOrEqual(1);

    // Contacts in list
    const members = await prisma.listMembership.findMany({
      where: { contactListId: list.id },
      include: { contact: true },
    });
    expect(members.length).toBeGreaterThanOrEqual(9);

    // Verify manual explicit classifications vs inferred classifications
    const luxuryContact = members.find((m) => m.contact.email === "aaditya.mehta@oberoihotels.test")?.contact;
    expect(luxuryContact).toBeDefined();
    expect(luxuryContact?.hotelSegment).toBe("LUXURY");
    expect(luxuryContact?.contactPersona).toBe("GENERAL_MANAGER");
    expect(luxuryContact?.hotelSegmentStatus).toBe("MANUAL");
    expect(luxuryContact?.hotelSegmentConfidence).toBe(1.0);

    // Verify contact with missing names imported safely with email
    const noNameContact = members.find((m) => m.contact.email === "ops.team@coastalretreat.test")?.contact;
    expect(noNameContact).toBeDefined();
    expect(noNameContact?.firstName).toBeNull();
    expect(noNameContact?.contactPersona).toBe("OPERATIONS_DIRECTOR");

    // Clean up list
    await prisma.contactList.delete({ where: { id: list.id } });
  });

  // =========================================================================
  // Step 3: Multiple-Template Selection & Priority Rules
  // =========================================================================
  it("Step 3: selects templates by priority, respects verified-only, handles overrides and fallbacks", async () => {
    // 4 Distinct Templates
    const tFallback = await prisma.template.create({
      data: {
        name: `General Intro ${Date.now()}`,
        subject: "Introduction for {{company|your hospitality team}}",
        bodyHtml: "<p>Dear {{firstName|Hospitality Leader}}, welcome.</p>",
        bodyText: "Dear {{firstName|Hospitality Leader}}, welcome.",
        version: 1,
      },
    });

    const tLuxuryGM = await prisma.template.create({
      data: {
        name: `Luxury Boutique GM ${Date.now()}`,
        subject: "Ensuring frontline service execution at {{company}}",
        bodyHtml: "<p>Dear {{firstName|General Manager}}, Mise Hotel pilot for luxury properties.</p>",
        bodyText: "Dear {{firstName|General Manager}}, Mise Hotel pilot for luxury properties.",
        version: 1,
      },
    });

    const tOps = await prisma.template.create({
      data: {
        name: `Operations Director SOP ${Date.now()}`,
        subject: "Operational visibility and SOP compliance at {{company}}",
        bodyHtml: "<p>Dear {{firstName|Director of Operations}}, verify daily SOPs.</p>",
        bodyText: "Dear {{firstName|Director of Operations}}, verify daily SOPs.",
        version: 1,
      },
    });

    const tOwner = await prisma.template.create({
      data: {
        name: `Owner-Operator Asset Quality ${Date.now()}`,
        subject: "Protecting brand equity at {{company}}",
        bodyHtml: "<p>Dear {{firstName|Hotel Owner}}, verifiable quality standards.</p>",
        bodyText: "Dear {{firstName|Hotel Owner}}, verifiable quality standards.",
        version: 1,
      },
    });

    const list = await prisma.contactList.create({
      data: { name: `Campaign Multi-Template List ${Date.now()}` },
    });

    // Create 4 distinct contacts representing different scenarios
    const cLuxuryVerified = await prisma.contact.create({
      data: {
        email: `c_luxury_${Date.now()}@example.com`,
        firstName: "Aaditya",
        company: "The Grand Palace",
        hotelSegment: "LUXURY",
        hotelSegmentConfidence: 1.0,
        hotelSegmentStatus: "VERIFIED",
        contactPersona: "GENERAL_MANAGER",
        contactPersonaConfidence: 1.0,
        contactPersonaStatus: "VERIFIED",
      },
    });

    const cLuxuryUnverified = await prisma.contact.create({
      data: {
        email: `c_unverified_${Date.now()}@example.com`,
        firstName: "Ramesh",
        company: "Grand Palace Estimate",
        hotelSegment: "LUXURY",
        hotelSegmentConfidence: 0.6,
        hotelSegmentStatus: "GUESSED", // Unverified guess
        contactPersona: "GENERAL_MANAGER",
        contactPersonaConfidence: 0.5,
        contactPersonaStatus: "GUESSED",
      },
    });

    const cOpsDirector = await prisma.contact.create({
      data: {
        email: `c_ops_${Date.now()}@example.com`,
        firstName: "Priya",
        company: "Radisson Suites",
        hotelSegment: "UPSCALE",
        hotelSegmentConfidence: 1.0,
        hotelSegmentStatus: "MANUAL",
        contactPersona: "OPERATIONS_DIRECTOR",
        contactPersonaConfidence: 1.0,
        contactPersonaStatus: "MANUAL",
      },
    });

    const cFallbackUser = await prisma.contact.create({
      data: {
        email: `c_fallback_${Date.now()}@example.com`,
        firstName: "Karan",
        company: "Independent Inn",
        hotelSegment: "INDEPENDENT",
        hotelSegmentStatus: "MANUAL",
        contactPersona: "OTHER",
        contactPersonaStatus: "MANUAL",
      },
    });

    for (const c of [cLuxuryVerified, cLuxuryUnverified, cOpsDirector, cFallbackUser]) {
      await prisma.listMembership.create({
        data: { contactListId: list.id, contactId: c.id },
      });
    }

    // Create campaign
    const campaign = await prisma.campaign.create({
      data: {
        name: `Multi-Template Test Campaign ${Date.now()}`,
        templateId: tFallback.id,
        contactListId: list.id,
        fromName: "FocusRealm Team",
        status: "DRAFT",
        campaignTemplates: {
          create: [
            { templateId: tFallback.id, isFallback: true, priority: 0 },
            { templateId: tLuxuryGM.id, isFallback: false, priority: 1 },
            { templateId: tOps.id, isFallback: false, priority: 2 },
            { templateId: tOwner.id, isFallback: false, priority: 3 },
          ],
        },
        rules: {
          create: [
            {
              priority: 1,
              templateId: tLuxuryGM.id,
              hotelSegment: "LUXURY",
              contactPersona: "GENERAL_MANAGER",
              requiresVerified: true, // Only verified matches Rule 1
              description: "Luxury GMs (Verified only)",
            },
            {
              priority: 2,
              templateId: tOps.id,
              contactPersona: "OPERATIONS_DIRECTOR",
              description: "Operations Directors",
            },
            {
              priority: 3,
              templateId: tOwner.id,
              contactPersona: "OWNER_OPERATOR",
              description: "Hotel Owners",
            },
          ],
        },
        // Manual override: pin cFallbackUser to tOwner
        recipientOverrides: {
          create: [
            {
              contactId: cFallbackUser.id,
              templateId: tOwner.id,
              reason: "VIP override requested by founder",
            },
          ],
        },
      },
    });

    // 1. Verify review builds with correct selections
    const reviewResult = await buildReview(campaign.id);
    expect(reviewResult.review.ready).toBe(4);
    expect(reviewResult.review.templateBreakdown.length).toBe(4);

    const readySample = reviewResult.ready;

    // Check cLuxuryVerified: matches Rule 1 (Luxury GMs)
    const verifiedSend = readySample.find((r) => r.contactId === cLuxuryVerified.id);
    expect(verifiedSend?.templateId).toBe(tLuxuryGM.id);
    expect(verifiedSend?.assignmentSource).toBe("RULE");
    expect(verifiedSend?.assignmentReason).toContain("Rule #1");
    expect(verifiedSend?.assignmentReason).toContain("matched");

    // Check cLuxuryUnverified: fails Rule 1 because requiresVerified=true, falls back to tFallback
    const unverifiedSend = readySample.find((r) => r.contactId === cLuxuryUnverified.id);
    expect(unverifiedSend?.templateId).toBe(tFallback.id);
    expect(unverifiedSend?.assignmentSource).toBe("FALLBACK");
    expect(unverifiedSend?.assignmentReason).toContain("Fallback");

    // Check cOpsDirector: matches Rule 2 (Operations Director)
    const opsSend = readySample.find((r) => r.contactId === cOpsDirector.id);
    expect(opsSend?.templateId).toBe(tOps.id);
    expect(opsSend?.assignmentSource).toBe("RULE");

    // Check cFallbackUser: manual override takes precedence and assigns tOwner
    const overrideSend = readySample.find((r) => r.contactId === cFallbackUser.id);
    expect(overrideSend?.templateId).toBe(tOwner.id);
    expect(overrideSend?.assignmentSource).toBe("OVERRIDE");
    expect(overrideSend?.assignmentReason).toContain("Manual override");

    // 2. Approve campaign -> Send records frozen
    await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "PENDING_APPROVAL" },
    });

    await approveCampaign(
      { user: testUser, ip: "127.0.0.1", get: () => "vitest" } as any,
      campaign.id,
      { contentHash: reviewResult.review.contentHash, ready: 4 }
    );

    const approvedSends = await prisma.send.findMany({
      where: { campaignId: campaign.id },
    });
    expect(approvedSends.length).toBe(4);

    // 3. Immutability verification: edit template in database and verify frozen send content is unchanged
    await prisma.template.update({
      where: { id: tLuxuryGM.id },
      data: {
        subject: "COMPLETELY CHANGED SUBJECT THAT MUST NOT AFFECT APPROVED SEND",
        bodyHtml: "<p>Changed body that must not leak.</p>",
      },
    });

    const frozenLuxurySend = await prisma.send.findFirst({
      where: { campaignId: campaign.id, contactId: cLuxuryVerified.id },
    });
    expect(frozenLuxurySend?.subject).toBe("Ensuring frontline service execution at The Grand Palace");
    expect(frozenLuxurySend?.html).toContain("Mise Hotel pilot for luxury properties");
    expect(frozenLuxurySend?.subject).not.toContain("COMPLETELY CHANGED");

    // Clean up
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.contactList.delete({ where: { id: list.id } });
    await prisma.contact.deleteMany({
      where: { id: { in: [cLuxuryVerified.id, cLuxuryUnverified.id, cOpsDirector.id, cFallbackUser.id] } },
    });
    await prisma.template.deleteMany({
      where: { id: { in: [tFallback.id, tLuxuryGM.id, tOps.id, tOwner.id] } },
    });
  });

  // =========================================================================
  // Step 4: Rendering Verification
  // =========================================================================
  it("Step 4: renders persona-appropriate messaging, fallbacks, valid links and no unresolved tags", () => {
    const templateParts = {
      subject: "Exclusive Mise Hotel pilot for {{company|your hotel}}",
      bodyHtml:
        "<p>Dear {{firstName|General Manager}},</p>" +
        "<p>We invite {{company|your team}} to explore our Service Execution Platform.</p>" +
        "<p>Visit <a href=\"https://misehotel.com/\">Mise Hotel</a> or <a href=\"https://focusrealm.org/\">FocusRealm</a>.</p>",
      bodyText:
        "Dear {{firstName|General Manager}},\n\n" +
        "We invite {{company|your team}} to explore our Service Execution Platform.\n\n" +
        "Visit https://misehotel.com/ or https://focusrealm.org/.",
    };

    // Recipient with complete data
    const completeRecipient = {
      email: "gm@luxuryhotel.test",
      firstName: "Arjun",
      lastName: "Mehta",
      company: "Northstar Hotels",
    };
    const rendered1 = renderEmail(templateParts, contactMergeData(completeRecipient));
    expect(rendered1.subject).toBe("Exclusive Mise Hotel pilot for Northstar Hotels");
    expect(rendered1.html).toContain("Dear Arjun,");
    expect(rendered1.html).toContain("We invite Northstar Hotels to explore");
    expect(rendered1.text).toContain("Dear Arjun,");
    expect(rendered1.missingFields.length).toBe(0);
    expect(rendered1.html).not.toMatch(/\{\{.*\}\}/);

    // Recipient with missing firstName and company -> fallbacks must kick in
    const missingRecipient = {
      email: "director@unknownhotel.test",
      firstName: null,
      company: null,
    };
    const rendered2 = renderEmail(templateParts, contactMergeData(missingRecipient));
    expect(rendered2.subject).toBe("Exclusive Mise Hotel pilot for your hotel");
    expect(rendered2.html).toContain("Dear General Manager,");
    expect(rendered2.html).toContain("We invite your team to explore");
    expect(rendered2.missingFields.length).toBe(0);
    expect(rendered2.html).not.toMatch(/\{\{.*\}\}/);
  });

  // =========================================================================
  // Step 5: Safe SMTP Sending Guard & Dry Run
  // =========================================================================
  it("Step 5: rejects unapproved test recipients and supports dry run preview without sending", async () => {
    expect(PERMITTED_TEST_RECIPIENTS).toContain("s265.frank@gmail.com");
    expect(PERMITTED_TEST_RECIPIENTS).toContain("aves7203@gmail.com");

    const template = await prisma.template.create({
      data: {
        name: `Safe Send Template ${Date.now()}`,
        subject: "Safe test for {{company|FocusRealm}}",
        bodyHtml: "<p>Hello {{firstName|there}}</p>",
        bodyText: "Hello {{firstName|there}}",
      },
    });

    const list = await prisma.contactList.create({
      data: { name: `Safe Send List ${Date.now()}` },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: `Safe Send Campaign ${Date.now()}`,
        templateId: template.id,
        contactListId: list.id,
        fromName: "FocusRealm Safe Sender",
        status: "DRAFT",
      },
    });

    // 0. Rejection of unapproved test recipients
    await expect(
      sendTest(
        { user: testUser, ip: "127.0.0.1", get: () => "vitest" } as any,
        campaign.id,
        ["unauthorized@outside.test"]
      )
    ).rejects.toThrow("Test sending is restricted to permitted test recipients only");

    // 1. Dry run execution
    const dryRunRes = await sendTest(
      { user: testUser, ip: "127.0.0.1", get: () => "vitest" } as any,
      campaign.id,
      ["s265.frank@gmail.com", "aves7203@gmail.com"],
      undefined,
      { dryRun: true }
    );

    expect(dryRunRes.dryRun).toBe(true);
    expect(dryRunRes.recipientCount).toBe(2);
    expect(dryRunRes.rendered.subject).toContain("[Test]");
    // Transport must not have been called during dry run
    expect(fakeTransport.sent.length).toBe(0);

    // 2. Live test send to permitted recipients
    const liveRes = await sendTest(
      { user: testUser, ip: "127.0.0.1", get: () => "vitest" } as any,
      campaign.id,
      ["s265.frank@gmail.com", "aves7203@gmail.com"],
      undefined,
      { dryRun: false }
    );

    expect(liveRes.dryRun).toBe(false);
    expect(liveRes.recipientCount).toBe(2);
    expect(fakeTransport.sent.length).toBe(2);
    expect(fakeTransport.sent.map((s) => s.to)).toEqual(["s265.frank@gmail.com", "aves7203@gmail.com"]);

    // Clean up
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.contactList.delete({ where: { id: list.id } });
    await prisma.template.delete({ where: { id: template.id } });
  });

  // =========================================================================
  // Step 6: Analytics & Outcome Attribution
  // =========================================================================
  it("Step 6: calculates analytics attribution by template, segment, and persona with documented denominators", async () => {
    const templateA = await prisma.template.create({
      data: {
        name: `Analytics Template A ${Date.now()}`,
        subject: "Subject A",
        bodyHtml: "<p>A</p>",
      },
    });

    const templateB = await prisma.template.create({
      data: {
        name: `Analytics Template B ${Date.now()}`,
        subject: "Subject B",
        bodyHtml: "<p>B</p>",
      },
    });

    const list = await prisma.contactList.create({
      data: { name: `Analytics List ${Date.now()}` },
    });

    const campaign = await prisma.campaign.create({
      data: {
        name: `Analytics Test Campaign ${Date.now()}`,
        templateId: templateA.id,
        contactListId: list.id,
        fromName: "FocusRealm Analytics",
        status: "SENDING",
      },
    });

    // Create 3 contacts with different segments and personas
    const c1 = await prisma.contact.create({
      data: {
        email: `c1_${Date.now()}@example.com`,
        hotelSegment: "LUXURY",
        contactPersona: "GENERAL_MANAGER",
      },
    });

    const c2 = await prisma.contact.create({
      data: {
        email: `c2_${Date.now()}@example.com`,
        hotelSegment: "BOUTIQUE",
        contactPersona: "OPERATIONS_DIRECTOR",
      },
    });

    const c3 = await prisma.contact.create({
      data: {
        email: `c3_${Date.now()}@example.com`,
        hotelSegment: "BOUTIQUE",
        contactPersona: "OWNER_OPERATOR",
      },
    });

    // Create 3 sends
    const s1 = await prisma.send.create({
      data: {
        campaignId: campaign.id,
        contactId: c1.id,
        email: c1.email,
        subject: "Subject A",
        html: "<p>A</p>",
        text: "A",
        messageId: `<s1_${Date.now()}@focusrealm.test>`,
        status: "SENT",
        sentAt: new Date(),
        templateId: templateA.id,
        templateVersion: 1,
        assignmentReason: "Rule A",
      },
    });

    const s2 = await prisma.send.create({
      data: {
        campaignId: campaign.id,
        contactId: c2.id,
        email: c2.email,
        subject: "Subject B",
        html: "<p>B</p>",
        text: "B",
        messageId: `<s2_${Date.now()}@focusrealm.test>`,
        status: "SENT",
        sentAt: new Date(),
        templateId: templateB.id,
        templateVersion: 1,
        assignmentReason: "Rule B",
      },
    });

    const s3 = await prisma.send.create({
      data: {
        campaignId: campaign.id,
        contactId: c3.id,
        email: c3.email,
        subject: "Subject B",
        html: "<p>B</p>",
        text: "B",
        messageId: `<s3_${Date.now()}@focusrealm.test>`,
        status: "FAILED",
        lastError: "Rejected: 550 Mailbox not found",
        bouncedAt: new Date(),
        templateId: templateB.id,
        templateVersion: 1,
        assignmentReason: "Rule B",
      },
    });

    // Record positive reply and meeting on s1
    await recordSendOutcome(s1.id, {
      replyClassification: "POSITIVE",
      meetingBooked: true,
      note: "Qualified meeting scheduled for Mise Hotel pilot",
    });

    const analytics = await getCampaignAnalytics(campaign.id);

    expect(analytics.totalRecipients).toBe(3);
    expect(analytics.providerAcceptedCount).toBe(2); // s1 and s2
    expect(analytics.bouncedCount).toBe(1); // s3
    expect(analytics.repliedCount).toBe(1); // s1
    expect(analytics.positiveRepliesCount).toBe(1); // s1
    expect(analytics.meetingsBookedCount).toBe(1); // s1

    // Rates verified against provider-accepted denominator (2)
    // replyRate: 1 / 2 = 50%
    expect(analytics.rates.replyRate).toBe(50);
    // meetingRate: 1 / 2 = 50%
    expect(analytics.rates.meetingRate).toBe(50);
    // bounceRate: 1 / 2 = 50%
    expect(analytics.rates.bounceRate).toBe(50);

    // Attribution by template
    const tAEntry = analytics.byTemplate.find((t) => t.templateId === templateA.id);
    expect(tAEntry?.sentCount).toBe(1);
    expect(tAEntry?.positiveRepliesCount).toBe(1);
    expect(tAEntry?.meetingsBookedCount).toBe(1);

    const tBEntry = analytics.byTemplate.find((t) => t.templateId === templateB.id);
    expect(tBEntry?.sentCount).toBe(1);
    expect(tBEntry?.positiveRepliesCount).toBe(0);

    // Attribution by segment
    const luxurySeg = analytics.byHotelSegment.find((s) => s.segment === "LUXURY");
    expect(luxurySeg?.meetingsBookedCount).toBe(1);

    // Clean up
    await prisma.campaign.delete({ where: { id: campaign.id } });
    await prisma.contactList.delete({ where: { id: list.id } });
    await prisma.contact.deleteMany({ where: { id: { in: [c1.id, c2.id, c3.id] } } });
    await prisma.template.deleteMany({ where: { id: { in: [templateA.id, templateB.id] } } });
  });
});
