import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  addBusinessDays,
  calculateNextActionTime,
  aiDraftFollowUp,
  stopSequenceForRecipient,
  pauseRecipientSequence,
  resumeRecipientSequence,
} from "./sequence-service.js";
import { classifyReplySentiment } from "./inbox-classifier.js";
import prisma from "../db.js";

describe("Follow-up Sequence Service", () => {
  describe("addBusinessDays calculation", () => {
    it("adds days within the same week correctly", () => {
      // Monday 2026-11-02
      const monday = new Date("2026-11-02T10:00:00Z");
      const tuesday = addBusinessDays(monday, 1);
      expect(tuesday.getUTCDay()).toBe(2); // Tuesday
      expect(tuesday.getUTCDate()).toBe(3);
    });

    it("skips Saturday and Sunday when adding 3 business days from Wednesday", () => {
      // Wednesday 2026-11-04
      const wednesday = new Date("2026-11-04T10:00:00Z");
      // +1 -> Thu, +2 -> Fri, +3 -> Mon (skips Sat & Sun)
      const nextDate = addBusinessDays(wednesday, 3);
      expect(nextDate.getUTCDay()).toBe(1); // Monday
      expect(nextDate.getUTCDate()).toBe(9);
    });

    it("skips weekend when adding 3 business days from Friday", () => {
      // Friday 2026-11-06
      const friday = new Date("2026-11-06T10:00:00Z");
      // +1 -> Mon, +2 -> Tue, +3 -> Wed
      const nextDate = addBusinessDays(friday, 3);
      expect(nextDate.getUTCDay()).toBe(3); // Wednesday
      expect(nextDate.getUTCDate()).toBe(11);
    });

    it("supports calendar days when delayBusinessDaysOnly is false", () => {
      const friday = new Date("2026-11-06T10:00:00Z");
      const nextDate = calculateNextActionTime(friday, 3, false);
      expect(nextDate.getUTCDay()).toBe(1); // Monday (calendar days: Fri -> Sat -> Sun -> Mon)
      expect(nextDate.getUTCDate()).toBe(9);
    });
  });

  describe("aiDraftFollowUp", () => {
    it("drafts Step 1 value proposition follow-up threaded to previous subject", async () => {
      const res = await aiDraftFollowUp({
        stepIndex: 1,
        purpose: "Value & Relevance",
        previousSubject: "Exploring collaboration with Grand Palace",
      });

      expect(res.subject).toBe("Re: Exploring collaboration with Grand Palace");
      expect(res.bodyText).toContain("Following up briefly on my earlier note");
      expect(res.bodyText).toContain("{{company|yours}}");
      expect(res.bodyHtml).toContain("<p>");
    });

    it("drafts Step 2 case study and brief follow-up", async () => {
      const res = await aiDraftFollowUp({
        stepIndex: 2,
        purpose: "Partnership Angle & Proof",
        previousSubject: "Re: Exploring collaboration with Grand Palace",
      });

      // Does not add duplicate 'Re: Re:'
      expect(res.subject).toBe("Re: Exploring collaboration with Grand Palace");
      expect(res.bodyText).toContain("2-page brief");
      expect(res.bodyText).toContain("{{company|your hotel}}");
    });

    it("drafts Step 3 permission-based breakup email", async () => {
      const res = await aiDraftFollowUp({
        stepIndex: 3,
        purpose: "Permission-based close / Breakup",
        previousSubject: "Re: Exploring collaboration with Grand Palace",
      });

      expect(res.subject).toBe("Re: Exploring collaboration with Grand Palace");
      expect(res.bodyText).toContain("I assume this isn't the right time");
      expect(res.bodyText).toContain("won't follow up again");
      expect(res.rationale).toContain("breakup");
    });
  });

  describe("Reply and Objection Classification", () => {
    it("detects objections such as budget and timing", () => {
      const res = classifyReplySentiment("We do not have budget for this right now, please check back next quarter.");
      expect(res.sentiment).toBe("OBJECTION");
      expect(res.confidence).toBeGreaterThan(0.8);
      expect(res.matchedKeywords.length).toBeGreaterThan(0);
    });

    it("detects existing vendor objections", () => {
      const res = classifyReplySentiment("We are already working with an existing vendor for guest engagement.");
      expect(res.sentiment).toBe("OBJECTION");
    });

    it("detects unsubscribe requests and marks isUnsubscribe", () => {
      const res = classifyReplySentiment("Please remove me from your mailing list and unsubscribe this address.");
      expect(res.sentiment).toBe("NEGATIVE");
      expect(res.category).toBe("UNSUBSCRIBE");
      expect(res.isUnsubscribe).toBe(true);
    });

    it("detects positive interest", () => {
      const res = classifyReplySentiment("Sounds good, let's schedule a call this Thursday at 2pm.");
      expect(res.sentiment).toBe("POSITIVE");
    });
  });

  describe("Sequence Stopping Rules", () => {
    it("cancels pending follow-ups and marks state when reply is detected", async () => {
      const mockCampaignId = "test-camp-123";
      const mockEmail = "gm@resort.com";

      const updateManySendsSpy = vi.spyOn(prisma.send, "updateMany").mockResolvedValue({ count: 2 });
      const upsertRecipientSpy = vi.spyOn(prisma.campaignRecipientState, "upsert").mockResolvedValue({
        id: "state-1",
        campaignId: mockCampaignId,
        contactId: null,
        email: mockEmail,
        state: "REPLY_RECEIVED",
        currentStepIndex: 1,
        nextActionAt: null,
        nextStepIndex: null,
        pausedReason: null,
        cancelledReason: "Reply received",
        lastSentAt: new Date(),
        lastMessageId: "<msg123@focusrealm.org>",
        repliedAt: new Date(),
        bouncedAt: null,
        unsubscribedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const cancelledCount = await stopSequenceForRecipient(
        mockCampaignId,
        mockEmail,
        "Reply received — outreach stopped",
        "REPLY_RECEIVED"
      );

      expect(cancelledCount).toBe(2);
      expect(updateManySendsSpy).toHaveBeenCalledWith({
        where: {
          campaignId: mockCampaignId,
          email: mockEmail,
          status: { in: ["PENDING", "CLAIMED"] },
          stepIndex: { gt: 0 },
        },
        data: {
          status: "CANCELLED",
          skipReason: "Reply received — outreach stopped",
        },
      });
      expect(upsertRecipientSpy).toHaveBeenCalled();
    });

    it("prevents resuming a sequence for a recipient who replied", async () => {
      const mockCampaignId = "test-camp-123";
      const mockEmail = "gm@resort.com";

      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValue({
        id: "state-1",
        campaignId: mockCampaignId,
        contactId: null,
        email: mockEmail,
        state: "REPLY_RECEIVED",
        currentStepIndex: 1,
        nextActionAt: null,
        nextStepIndex: null,
        pausedReason: null,
        cancelledReason: "Reply received",
        lastSentAt: new Date(),
        lastMessageId: "<msg123@focusrealm.org>",
        repliedAt: new Date(),
        bouncedAt: null,
        unsubscribedAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await expect(resumeRecipientSequence(mockCampaignId, mockEmail)).rejects.toThrow(
        "Cannot resume: recipient sent a reply"
      );
    });
  });
});
