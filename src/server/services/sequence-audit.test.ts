import { describe, it, expect, vi, beforeEach } from "vitest";
import prisma from "../db.js";
import * as config from "../config.js";
import {
  recoverInterruptedSends,
  hasQueuedWork,
  sendOne,
} from "./send-worker.js";
import {
  isInboxMonitoringSafe,
  _applyClassification,
} from "./inbox-monitor.js";
import {
  onStepSent,
  stopSequenceForRecipient,
  approveFollowUpSend,
  pauseRecipientSequence,
  resumeRecipientSequence,
  stopAllPendingFollowUps,
} from "./sequence-service.js";
import type { IncomingMessage } from "./inbox-classifier.js";
import * as mailer from "./mailer.js";

describe("Production Readiness Audit - Follow-Up Sequence & Background Processing", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    // Default safe mocks for count to avoid DB connections in finishIfDone
    vi.spyOn(prisma.send, "count").mockResolvedValue(1);
    vi.spyOn(prisma.campaignRecipientState, "count").mockResolvedValue(1);
  });

  describe("1. Scheduled Jobs Persistence, Crash Recovery & Concurrency Safety", () => {
    it("recovers interrupted sends as UNKNOWN so they are never silently resent", async () => {
      const updateManySpy = vi.spyOn(prisma.send, "updateMany").mockResolvedValue({ count: 2 } as any);

      const recoveredCount = await recoverInterruptedSends(0);
      expect(recoveredCount).toBe(2);
      expect(updateManySpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { status: "CLAIMED" },
          data: expect.objectContaining({
            status: "UNKNOWN",
          }),
        })
      );
    });

    it("hasQueuedWork only returns true when claimable work is due and approved or automatic", async () => {
      const findFirstSpy = vi.spyOn(prisma.send, "findFirst");

      // Case A: Nothing claimable
      findFirstSpy.mockResolvedValueOnce(null);
      const workA = await hasQueuedWork();
      expect(workA).toBe(false);

      // Case B: Claimable message exists
      findFirstSpy.mockResolvedValueOnce({ id: "send-1" } as any);
      const workB = await hasQueuedWork();
      expect(workB).toBe(true);

      // Verify the query structure includes the AND condition for approval or automatic
      expect(findFirstSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: "PENDING",
            campaign: { status: "SENDING" },
            AND: [
              {
                OR: [
                  { approvedAt: { not: null } },
                  { campaign: { automationMode: "AUTOMATIC" } },
                ],
              },
            ],
          }),
        })
      );
    });
  });

  describe("2. Automation Modes Isolation (Approval-Required vs Automatic vs Manual)", () => {
    it("approval-required mode: does not allow sendOne if follow-up is not approved", async () => {
      // Setup mock where raw query returns no rows because approvedAt is null
      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([]);

      const campaign = { id: "camp-appr-req", fromName: "FR Team", replyTo: null };
      const didWork = await sendOne(campaign);
      expect(didWork).toBe(false);
    });

    it("automatic mode: transitions recipient to FOLLOW_UP_SCHEDULED with immediate approvedAt", async () => {
      const campaignId = "camp-auto";
      const recipientEmail = "guest@palace.com";
      const templateId = "tpl-followup";

      vi.spyOn(prisma.send, "findUnique").mockResolvedValue({
        id: "send-initial",
        campaignId,
        email: recipientEmail,
        contactId: "c-1",
        stepIndex: 0,
        sentAt: new Date(),
        messageId: "<initial@focusrealm.org>",
        subject: "Welcome",
        campaign: {
          id: campaignId,
          fromName: "FR Team",
          automationMode: "AUTOMATIC",
          sequenceSteps: [
            {
              stepIndex: 1,
              purpose: "Value",
              delayDays: 3,
              delayBusinessDaysOnly: true,
              subjectMode: "THREADED",
              templateId,
              template: {
                id: templateId,
                subject: "Quick follow-up",
                bodyHtml: "<p>Following up</p>",
                bodyText: "Following up",
              },
            },
          ],
        },
        contact: {
          id: "c-1",
          email: recipientEmail,
          firstName: "Siddharth",
          company: "Grand Palace",
          enrichmentData: null,
        },
      } as any);

      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValue({
        state: "PENDING_INITIAL",
      } as any);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);

      let createdSend: any = null;
      let updatedRecipientState: any = null;

      (vi.spyOn(prisma.send, "upsert") as any).mockImplementation(async (args: any) => {
        createdSend = args.create;
        return createdSend;
      });
      (vi.spyOn(prisma.campaignRecipientState, "upsert") as any).mockImplementation(async (args: any) => {
        updatedRecipientState = args.update;
        return updatedRecipientState;
      });

      await onStepSent("send-initial", prisma);

      expect(createdSend).not.toBeNull();
      expect(createdSend.approvedAt).not.toBeNull(); // Automatically approved
      expect(createdSend.stepIndex).toBe(1);
      expect(updatedRecipientState.state).toBe("FOLLOW_UP_SCHEDULED");
    });

    it("manual mode: follow-up is paused until explicit manual action", async () => {
      const campaignId = "camp-manual";
      const recipientEmail = "hotel@resort.com";
      const templateId = "tpl-followup";

      vi.spyOn(prisma.send, "findUnique").mockResolvedValue({
        id: "send-init",
        campaignId,
        email: recipientEmail,
        contactId: "c-2",
        stepIndex: 0,
        sentAt: new Date(),
        messageId: "<manual-init@focusrealm.org>",
        subject: "Intro",
        campaign: {
          id: campaignId,
          fromName: "FR Team",
          automationMode: "MANUAL",
          sequenceSteps: [
            {
              stepIndex: 1,
              purpose: "Check-in",
              delayDays: 3,
              delayBusinessDaysOnly: true,
              subjectMode: "THREADED",
              templateId,
              template: {
                id: templateId,
                subject: "Check-in",
                bodyHtml: "<p>Checking in</p>",
                bodyText: "Checking in",
              },
            },
          ],
        },
        contact: { id: "c-2", email: recipientEmail, firstName: "Anya", company: "Seaside Resort", enrichmentData: null },
      } as any);

      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);

      let createdSend: any = null;
      let updatedRecipientState: any = null;

      (vi.spyOn(prisma.send, "upsert") as any).mockImplementation(async (args: any) => {
        createdSend = args.create;
        return createdSend;
      });
      (vi.spyOn(prisma.campaignRecipientState, "upsert") as any).mockImplementation(async (args: any) => {
        updatedRecipientState = args.update;
        return updatedRecipientState;
      });

      await onStepSent("send-init", prisma);

      expect(createdSend.approvedAt).toBeNull();
      expect(updatedRecipientState.state).toBe("PAUSED");
      expect(updatedRecipientState.pausedReason).toContain("Manual mode");
    });
  });

  describe("3. Inbound Reply Matching & Edge Case Handling", () => {
    it("matches reply by In-Reply-To header and halts the sequence", async () => {
      const campaignId = "camp-reply-test";
      const recipientEmail = "director@luxuryvillas.com";
      const messageId = "<msg-101@focusrealm.org>";

      vi.spyOn(prisma.send, "findMany").mockResolvedValue([
        {
          id: "send-101",
          campaignId,
          email: recipientEmail,
          messageId,
          status: "SENT",
          repliedAt: null,
        } as any,
      ]);

      vi.spyOn(prisma.sendEvent, "findFirst").mockResolvedValue(null); // No prior reply event

      let stoppedCampaignId = "";
      let stoppedEmail = "";
      let stoppedState = "";

      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          sendEvent: { create: vi.fn().mockResolvedValue({}) },
          send: {
            update: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          campaignRecipientState: {
            upsert: vi.fn().mockImplementation(async (args: any) => {
              stoppedCampaignId = args.create.campaignId;
              stoppedEmail = args.create.email;
              stoppedState = args.create.state;
            }),
          },
        };
        return cb(tx);
      });

      const incomingMsg: IncomingMessage = {
        from: `Director <${recipientEmail}>`,
        subject: "Re: Partnership opportunity",
        headers: {
          "in-reply-to": messageId,
        },
        text: "Thanks for reaching out, let's connect on Friday at 2pm.",
        attachments: [],
        date: new Date(),
      };

      const outcome = await _applyClassification(incomingMsg, "focusrealm.org");
      expect(outcome).toBe("reply");
      expect(stoppedCampaignId).toBe(campaignId);
      expect(stoppedEmail).toBe(recipientEmail);
      expect(stoppedState).toBe("REPLY_RECEIVED");
    });

    it("falls back to recipient email when reply headers contain unknown messageId", async () => {
      const recipientEmail = "owner@boutiquehotel.com";

      vi.spyOn(prisma.send, "findMany").mockResolvedValue([]); // No direct messageId match in DB
      vi.spyOn(prisma.send, "findFirst").mockResolvedValue({
        id: "send-fallback-1",
        campaignId: "camp-fallback",
        email: recipientEmail,
        status: "SENT",
        repliedAt: null,
      } as any);

      vi.spyOn(prisma.sendEvent, "findFirst").mockResolvedValue(null);

      vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
        const tx = {
          sendEvent: { create: vi.fn().mockResolvedValue({}) },
          send: {
            update: vi.fn().mockResolvedValue({}),
            updateMany: vi.fn().mockResolvedValue({ count: 1 }),
          },
          campaignRecipientState: { upsert: vi.fn().mockResolvedValue({}) },
        };
        return cb(tx);
      });

      const incomingMsg: IncomingMessage = {
        from: `Owner <${recipientEmail}>`,
        subject: "Re: Something else",
        headers: {
          "in-reply-to": "<some-unknown-id@focusrealm.org>",
        },
        text: "Yes, I am interested.",
        attachments: [],
        date: new Date(),
      };

      const outcome = await _applyClassification(incomingMsg, "focusrealm.org");
      expect(outcome).toBe("reply");
    });

    it("records unmatched reply without assigning to wrong recipient when email is unknown", async () => {
      vi.spyOn(prisma.send, "findMany").mockResolvedValue([]);
      vi.spyOn(prisma.send, "findFirst").mockResolvedValue(null); // Unknown email

      let savedSetting: any = null;
      vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
        id: "s-1",
        key: "imap.state",
        value: { unmatchedReplies: [] },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);
      (vi.spyOn(prisma.setting, "upsert") as any).mockImplementation(async (args: any) => {
        savedSetting = args.update.value;
        return {} as any;
      });

      const incomingMsg: IncomingMessage = {
        from: "stranger@unknownhotel.com",
        subject: "Unrelated question",
        headers: {
          "in-reply-to": "<some-other-id@focusrealm.org>",
        },
        text: "Who is this?",
        attachments: [],
        date: new Date(),
      };

      const outcome = await _applyClassification(incomingMsg, "focusrealm.org");
      expect(outcome).toBeNull();
      expect(savedSetting).not.toBeNull();
      expect(savedSetting.unmatchedReplies).toHaveLength(1);
      expect(savedSetting.unmatchedReplies[0].from).toBe("stranger@unknownhotel.com");
    });

    it("ignores duplicate inbound events idempotently", async () => {
      vi.spyOn(prisma.send, "findMany").mockResolvedValue([
        {
          id: "send-dup",
          campaignId: "camp-dup",
          email: "test@dup.com",
          messageId: "<dup@focusrealm.org>",
        } as any,
      ]);

      // Existing reply event already recorded
      vi.spyOn(prisma.sendEvent, "findFirst").mockResolvedValue({ id: "evt-1" } as any);
      const txSpy = vi.spyOn(prisma, "$transaction");

      const incomingMsg: IncomingMessage = {
        from: "test@dup.com",
        subject: "Re: Test",
        headers: { "in-reply-to": "<dup@focusrealm.org>" },
        text: "I already replied earlier.",
        attachments: [],
        date: new Date(),
      };

      const outcome = await _applyClassification(incomingMsg, "focusrealm.org");
      expect(outcome).toBe("reply");
      expect(txSpy).not.toHaveBeenCalled(); // Skipped redundant event creation
    });
  });

  describe("4. Stopping Rules & Last-Second Cancellation", () => {
    it("cancels follow-up in sendOne if recipient replied shortly before send", async () => {
      // Mock claimed follow-up send (stepIndex: 1)
      const claimedSend = {
        id: "send-fu-1",
        campaignId: "camp-halt",
        email: "guest@resort.com",
        subject: "Re: Partnership",
        html: "<p>Followup</p>",
        text: "Followup",
        messageId: "<fu-1@focusrealm.org>",
        stepIndex: 1,
        inReplyToId: "<initial@focusrealm.org>",
      };

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([claimedSend]);
      vi.spyOn(prisma.campaign, "findUnique").mockResolvedValue({ status: "SENDING" } as any);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);

      // Prior reply was detected right before sendOne
      vi.spyOn(prisma.send, "findFirst").mockResolvedValueOnce({ id: "send-initial-replied" } as any);

      const updateSpy = vi.spyOn(prisma.send, "update").mockResolvedValue({} as any);
      const transportSpy = vi.spyOn(mailer, "getTransport");

      const didWork = await sendOne({ id: "camp-halt", fromName: "FR Team", replyTo: null });
      expect(didWork).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "send-fu-1" },
          data: expect.objectContaining({
            status: "CANCELLED",
            skipReason: expect.stringContaining("Reply received"),
          }),
        })
      );
      expect(transportSpy).not.toHaveBeenCalled();
    });

    it("cancels follow-up in sendOne if recipient state is PAUSED, BOUNCED or CANCELLED", async () => {
      const claimedSend = {
        id: "send-fu-2",
        campaignId: "camp-halt-2",
        email: "paused@resort.com",
        subject: "Re: Partnership",
        html: "<p>Followup</p>",
        text: "Followup",
        messageId: "<fu-2@focusrealm.org>",
        stepIndex: 1,
        inReplyToId: "<initial@focusrealm.org>",
      };

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([claimedSend]);
      vi.spyOn(prisma.campaign, "findUnique").mockResolvedValue({ status: "SENDING" } as any);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.send, "findFirst").mockResolvedValueOnce(null); // No direct reply

      // Recipient state is PAUSED
      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValueOnce({ state: "PAUSED" } as any);

      const updateSpy = vi.spyOn(prisma.send, "update").mockResolvedValue({} as any);
      const transportSpy = vi.spyOn(mailer, "getTransport");

      const didWork = await sendOne({ id: "camp-halt-2", fromName: "FR Team", replyTo: null });
      expect(didWork).toBe(true);
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "send-fu-2" },
          data: expect.objectContaining({
            status: "CANCELLED",
            skipReason: expect.stringContaining("PAUSED"),
          }),
        })
      );
      expect(transportSpy).not.toHaveBeenCalled();
    });

    it("stopAllPendingFollowUps halts all pending sends and marks recipients CANCELLED", async () => {
      vi.spyOn(prisma.send, "updateMany").mockResolvedValue({ count: 42 } as any);
      vi.spyOn(prisma.campaignRecipientState, "updateMany").mockResolvedValue({ count: 42 } as any);

      const count = await stopAllPendingFollowUps("camp-stop-all", "Campaign ended");
      expect(count).toBe(42);
      expect(prisma.send.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campaignId: "camp-stop-all",
            status: { in: ["PENDING", "CLAIMED"] },
            stepIndex: { gt: 0 },
          },
          data: {
            status: "CANCELLED",
            skipReason: "Campaign ended",
          },
        })
      );
    });
  });

  describe("5. Mailbox Health Guard & Inbox Freshness Threshold", () => {
    it("isInboxMonitoringSafe flags error when inbox monitor failed", async () => {
      vi.spyOn(config, "imapConfigured", "get").mockReturnValue(true);
      (config.env as any).IMAP_POLL_ENABLED = true;

      vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
        id: "s-1",
        key: "imap.state",
        value: {
          lastCheckedAt: new Date().toISOString(),
          lastError: "Authentication failed: invalid app password",
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const health = await isInboxMonitoringSafe();
      expect(health.safe).toBe(false);
      expect(health.reason).toContain("Inbox monitoring error");
    });

    it("isInboxMonitoringSafe flags delay when last sync exceeds freshness threshold", async () => {
      vi.spyOn(config, "imapConfigured", "get").mockReturnValue(true);
      (config.env as any).IMAP_POLL_ENABLED = true;

      // 30 minutes ago (> 7 minutes threshold)
      const thirtyMinsAgo = new Date(Date.now() - 30 * 60 * 1000).toISOString();
      vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
        id: "s-1",
        key: "imap.state",
        value: {
          lastCheckedAt: thirtyMinsAgo,
          lastError: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const health = await isInboxMonitoringSafe();
      expect(health.safe).toBe(false);
      expect(health.reason).toContain("delayed");
    });

    it("defers follow-up when inbox monitoring is stale, decrementing attempts", async () => {
      vi.spyOn(config, "imapConfigured", "get").mockReturnValue(true);
      (config.env as any).IMAP_POLL_ENABLED = true;

      const claimedSend = {
        id: "send-fu-defer",
        campaignId: "camp-defer",
        email: "client@defer.com",
        subject: "Re: Followup",
        html: "<p>Text</p>",
        text: "Text",
        messageId: "<defer@focusrealm.org>",
        stepIndex: 1,
        inReplyToId: "<init@focusrealm.org>",
      };

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([claimedSend]);
      vi.spyOn(prisma.campaign, "findUnique").mockResolvedValue({ status: "SENDING" } as any);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.send, "findFirst").mockResolvedValueOnce(null);
      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValueOnce({ state: "FOLLOW_UP_SCHEDULED" } as any);

      // Stale inbox state (1 hour ago)
      vi.spyOn(prisma.setting, "findUnique").mockResolvedValue({
        id: "s-1",
        key: "imap.state",
        value: {
          lastCheckedAt: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          lastError: null,
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      } as any);

      const updateSpy = vi.spyOn(prisma.send, "update").mockResolvedValue({} as any);
      const transportSpy = vi.spyOn(mailer, "getTransport");

      const didWork = await sendOne({ id: "camp-defer", fromName: "FR Team", replyTo: null });
      expect(didWork).toBe(false); // Deferred
      expect(updateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: "send-fu-defer" },
          data: expect.objectContaining({
            status: "PENDING",
            attempts: { decrement: 1 },
            lastError: expect.stringContaining("Deferred: Inbox monitoring is delayed"),
          }),
        })
      );
      expect(transportSpy).not.toHaveBeenCalled();
    });
  });

  describe("6. Exact Approved Message Integrity & Non-Overwritable Overrides", () => {
    it("sendOne dispatches the exact subject and bodyHtml stored on the approved Send row", async () => {
      const claimedSend = {
        id: "send-exact-1",
        campaignId: "camp-exact",
        email: "vip@luxuryresort.com",
        subject: "Custom tailored partnership note for General Manager",
        html: "<p>Specifically crafted text that was approved</p>",
        text: "Specifically crafted text that was approved",
        messageId: "<exact-1@focusrealm.org>",
        stepIndex: 1,
        inReplyToId: "<initial-1@focusrealm.org>",
      };

      vi.spyOn(prisma, "$queryRaw").mockResolvedValueOnce([claimedSend]);
      vi.spyOn(prisma.campaign, "findUnique").mockResolvedValue({ status: "SENDING" } as any);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.send, "findFirst").mockResolvedValueOnce(null);
      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValueOnce({ state: "FOLLOW_UP_SCHEDULED" } as any);

      // Healthy inbox
      vi.spyOn(config, "imapConfigured", "get").mockReturnValue(false); // Bypass inbox stale check for this test

      const mockSend = vi.fn().mockResolvedValue({});
      vi.spyOn(mailer, "getTransport").mockReturnValue({ send: mockSend } as any);
      vi.spyOn(prisma.send, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.send, "update").mockResolvedValue({} as any);
      vi.spyOn(prisma.send, "count").mockResolvedValue(1);
      vi.spyOn(prisma.campaignRecipientState, "count").mockResolvedValue(1);

      const didWork = await sendOne({ id: "camp-exact", fromName: "FocusRealm Founder's Office", replyTo: "founders@focusrealm.org" });
      expect(didWork).toBe(true);

      // Verify the EXACT subject and html from the database row were passed to SMTP
      expect(mockSend).toHaveBeenCalledWith(
        expect.objectContaining({
          to: "vip@luxuryresort.com",
          subject: "Custom tailored partnership note for General Manager",
          html: "<p>Specifically crafted text that was approved</p>",
          headers: expect.objectContaining({
            "In-Reply-To": "<initial-1@focusrealm.org>",
            "References": "<initial-1@focusrealm.org>",
          }),
        })
      );
    });

    it("onStepSent upsert preserves existing custom edits and does not silently overwrite them", async () => {
      const campaignId = "camp-custom-edit";
      const recipientEmail = "contact@boutique.com";

      vi.spyOn(prisma.send, "findUnique").mockResolvedValue({
        id: "send-step-0",
        campaignId,
        email: recipientEmail,
        contactId: "c-10",
        stepIndex: 0,
        sentAt: new Date(),
        messageId: "<msg-step-0@focusrealm.org>",
        subject: "Intro",
        campaign: {
          id: campaignId,
          fromName: "FR Team",
          automationMode: "APPROVAL_REQUIRED",
          sequenceSteps: [
            {
              stepIndex: 1,
              purpose: "Follow-up",
              delayDays: 3,
              delayBusinessDaysOnly: true,
              subjectMode: "THREADED",
              templateId: "tpl-1",
              template: {
                id: "tpl-1",
                subject: "Default template subject",
                bodyHtml: "<p>Default template body</p>",
                bodyText: "Default template body",
              },
            },
          ],
        },
        contact: { id: "c-10", email: recipientEmail, firstName: "Meera", company: "Boutique Stay", enrichmentData: null },
      } as any);

      vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValue(null);
      vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);

      const upsertSpy = vi.spyOn(prisma.send, "upsert").mockResolvedValue({} as any);
      vi.spyOn(prisma.campaignRecipientState, "upsert").mockResolvedValue({} as any);

      await onStepSent("send-step-0", prisma);

      // Verify upsert has empty update so existing rows are not overwritten
      expect(upsertSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            campaignId_email_stepIndex: {
              campaignId,
              email: recipientEmail,
              stepIndex: 1,
            },
          },
          update: {}, // Non-destructive!
        })
      );
    });
  });
});
