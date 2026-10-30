// Integration test for multi-template campaigns, rule evaluation, manual overrides, and approval freezing.
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { Request } from "express";
import prisma from "../db.js";
import { approveCampaign, requestApproval, reviewCampaign } from "./campaign-service.js";
import { hashPassword } from "./auth-service.js";

const fakeReq = (user: { id: string; name: string; role: "FOUNDER" | "EMPLOYEE" }) =>
  ({ user: { ...user, email: `${user.id}@focusrealm.test`, status: "ACTIVE" }, ip: "127.0.0.1", get: () => "vitest" }) as unknown as Request;

async function resetDb() {
  await prisma.$executeRawUnsafe(
    `TRUNCATE send_events, sends, campaign_recipient_overrides, campaign_rules, campaign_templates, campaigns, campaign_members, import_batches, contact_lists, enrichments, contacts, templates, suppression_entries, audit_logs, sessions, auth_tokens, users, settings CASCADE`
  );
}

beforeEach(async () => {
  await resetDb();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe("multi-template campaigns & rule-based selection", () => {
  it("assigns templates according to priority rules, verified constraints, and manual overrides", async () => {
    // 1. Create founder user
    const founder = await prisma.user.create({
      data: { email: "founder@focusrealm.test", name: "Fay Founder", role: "FOUNDER", status: "ACTIVE", passwordHash: await hashPassword("pass") },
    });
    const founderReq = fakeReq({ id: founder.id, name: founder.name, role: "FOUNDER" });

    // 2. Create list and contacts with segments, personas, and confidence/verification status
    const list = await prisma.contactList.create({ data: { name: "Hotels List" } });

    // Contact 1: Luxury GM (verified) -> Should match Rule 1
    const c1 = await prisma.contact.create({
      data: {
        email: "gm@luxuryresort.test",
        firstName: "Victoria",
        company: "Grand Palace Resort",
        hotelSegment: "LUXURY",
        hotelSegmentStatus: "VERIFIED",
        hotelSegmentConfidence: 1.0,
        contactPersona: "GENERAL_MANAGER",
        contactPersonaStatus: "VERIFIED",
        contactPersonaConfidence: 1.0,
      },
    });

    // Contact 2: Boutique Hotel GM (guessed segment) -> Should match Rule 2 (Boutique)
    const c2 = await prisma.contact.create({
      data: {
        email: "gm@boutiqueinn.test",
        firstName: "Marc",
        company: "Maison Chic",
        hotelSegment: "BOUTIQUE",
        hotelSegmentStatus: "GUESSED",
        hotelSegmentConfidence: 0.7,
        contactPersona: "GENERAL_MANAGER",
      },
    });

    // Contact 3: Unverified Luxury Director -> Rule 1 requires verified, so should fall back
    const c3 = await prisma.contact.create({
      data: {
        email: "unverified@luxury.test",
        firstName: "Gareth",
        company: "Luxury Heights",
        hotelSegment: "LUXURY",
        hotelSegmentStatus: "GUESSED",
        hotelSegmentConfidence: 0.5,
        contactPersona: "GENERAL_MANAGER",
      },
    });

    // Contact 4: Budget property -> Has manual override to Boutique template
    const c4 = await prisma.contact.create({
      data: {
        email: "override@budgetmotel.test",
        firstName: "Chloe",
        company: "Value Lodge",
        hotelSegment: "BUDGET",
        contactPersona: "OWNER_OPERATOR",
      },
    });

    await prisma.listMembership.createMany({
      data: [
        { contactId: c1.id, contactListId: list.id },
        { contactId: c2.id, contactListId: list.id },
        { contactId: c3.id, contactListId: list.id },
        { contactId: c4.id, contactListId: list.id },
      ],
    });

    // 3. Create templates
    const tDefault = await prisma.template.create({
      data: { name: "Default Template", subject: "FocusRealm Note for {{company}}", bodyHtml: "<p>General note for {{firstName}}</p>" },
    });
    const tLuxury = await prisma.template.create({
      data: { name: "Luxury GM Briefing", subject: "Exclusive Briefing for {{company}}", bodyHtml: "<p>Luxury briefing for GM {{firstName}}</p>" },
    });
    const tBoutique = await prisma.template.create({
      data: { name: "Boutique Experience", subject: "Curated Solution for {{company}}", bodyHtml: "<p>Boutique experience for {{firstName}}</p>" },
    });

    // 4. Create campaign with fallback template
    const campaign = await prisma.campaign.create({
      data: {
        name: "Q4 Multi-Template Outreach",
        templateId: tDefault.id,
        contactListId: list.id,
        fromName: "FocusRealm",
        createdById: founder.id,
      },
    });

    // 5. Add eligible templates
    await prisma.campaignTemplate.createMany({
      data: [
        { campaignId: campaign.id, templateId: tDefault.id, isFallback: true, priority: 0 },
        { campaignId: campaign.id, templateId: tLuxury.id, isFallback: false, priority: 1 },
        { campaignId: campaign.id, templateId: tBoutique.id, isFallback: false, priority: 2 },
      ],
    });

    // 6. Add rules:
    // Rule 1: Priority 1 -> Luxury + GM (requires verified)
    const rule1 = await prisma.campaignRule.create({
      data: {
        campaignId: campaign.id,
        templateId: tLuxury.id,
        priority: 1,
        hotelSegment: "LUXURY",
        contactPersona: "GENERAL_MANAGER",
        requiresVerified: true,
        description: "Verified Luxury GMs",
      },
    });

    // Rule 2: Priority 2 -> Boutique (any persona, does not require verified)
    const rule2 = await prisma.campaignRule.create({
      data: {
        campaignId: campaign.id,
        templateId: tBoutique.id,
        priority: 2,
        hotelSegment: "BOUTIQUE",
        description: "Boutique Properties",
      },
    });

    // 7. Add recipient override for c4 -> Assign tBoutique
    await prisma.campaignRecipientOverride.create({
      data: {
        campaignId: campaign.id,
        contactId: c4.id,
        templateId: tBoutique.id,
        reason: "Requested boutique template on intro call",
      },
    });

    // 8. Run Review
    const review = await reviewCampaign(campaign.id);
    expect(review.total).toBe(4);
    expect(review.ready).toBe(4);
    expect(review.issueCount).toBe(0);

    // Check template breakdown
    const breakdownMap = new Map(review.templateBreakdown.map((b) => [b.templateId, b.count]));
    expect(breakdownMap.get(tLuxury.id)).toBe(1); // c1
    expect(breakdownMap.get(tBoutique.id)).toBe(2); // c2 (via rule 2) + c4 (via override)
    expect(breakdownMap.get(tDefault.id)).toBe(1); // c3 (fell back because unverified)

    // Check individual sample assignments
    const s1 = review.sample.find((s) => s.contactId === c1.id)!;
    expect(s1.templateId).toBe(tLuxury.id);
    expect(s1.assignmentSource).toBe("RULE");
    expect(s1.assignmentReason).toContain("Rule #1 (Verified Luxury GMs)");
    expect(s1.subject).toBe("Exclusive Briefing for Grand Palace Resort");

    const s2 = review.sample.find((s) => s.contactId === c2.id)!;
    expect(s2.templateId).toBe(tBoutique.id);
    expect(s2.assignmentSource).toBe("RULE");
    expect(s2.assignmentReason).toContain("Rule #2 (Boutique Properties)");

    const s3 = review.sample.find((s) => s.contactId === c3.id)!;
    expect(s3.templateId).toBe(tDefault.id);
    expect(s3.assignmentSource).toBe("FALLBACK");
    expect(s3.assignmentReason).toContain("Fallback template");

    const s4 = review.sample.find((s) => s.contactId === c4.id)!;
    expect(s4.templateId).toBe(tBoutique.id);
    expect(s4.assignmentSource).toBe("OVERRIDE");
    expect(s4.assignmentReason).toBe("Manual override: Requested boutique template on intro call");

    // 9. Approve campaign and verify Send snapshots
    await requestApproval(founderReq, campaign.id);
    await approveCampaign(founderReq, campaign.id, { contentHash: review.contentHash, ready: review.ready });

    const sends = await prisma.send.findMany({ where: { campaignId: campaign.id }, orderBy: { email: "asc" } });
    expect(sends.length).toBe(4);

    const send1 = sends.find((s) => s.contactId === c1.id)!;
    expect(send1.templateId).toBe(tLuxury.id);
    expect(send1.subject).toBe("Exclusive Briefing for Grand Palace Resort");
    expect(send1.html).toContain("Luxury briefing for GM Victoria");
    expect(send1.assignmentReason).toContain("Rule #1");

    const send4 = sends.find((s) => s.contactId === c4.id)!;
    expect(send4.templateId).toBe(tBoutique.id);
    expect(send4.html).toContain("Boutique experience for Chloe");
    expect(send4.assignmentReason).toContain("Requested boutique template on intro call");

    // 10. Modifying original templates must not change frozen sends
    await prisma.template.update({
      where: { id: tLuxury.id },
      data: { subject: "CHANGED SUBJECT LATER" },
    });

    const send1After = await prisma.send.findUniqueOrThrow({ where: { id: send1.id } });
    expect(send1After.subject).toBe("Exclusive Briefing for Grand Palace Resort");
  });
});
