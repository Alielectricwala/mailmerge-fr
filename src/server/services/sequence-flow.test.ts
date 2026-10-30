import { describe, it, expect, vi } from "vitest";
import prisma from "../db.js";
import { onStepSent, stopSequenceForRecipient, approveFollowUpSend } from "./sequence-service.js";
import type { IncomingMessage } from "./inbox-classifier.js";

describe("Follow-up Sequence End-to-End Workflow & Safeguards", () => {
  it("executes the controlled follow-up lifecycle and halts safely on reply", async () => {
    const campaignId = "seq-test-campaign-1";
    const recipientEmail = "generalmanager@grandresort.com";
    const step0MessageId = "<step0-initial-msg@focusrealm.org>";
    const template0Id = "tpl-step-0";
    const template1Id = "tpl-step-1";

    // 1. Setup mock campaign with Approval Required mode and 2 sequence steps
    (vi.spyOn(prisma.campaign, "findUnique") as any).mockImplementation(async () => {
      return {
        id: campaignId,
        name: "Goa Luxury Outreach",
        automationMode: "APPROVAL_REQUIRED",
        fromName: "FocusRealm Founder's Office",
        replyTo: null,
        sequenceSteps: [
          {
            id: "step-0",
            campaignId,
            stepIndex: 0,
            purpose: "Initial Outreach",
            delayDays: 0,
            delayBusinessDaysOnly: true,
            subjectMode: "STANDALONE",
            customSubject: null,
            templateId: template0Id,
            template: {
              id: template0Id,
              name: "Introductory Outreach",
              subject: "FocusRealm Partnership for {{company}}",
              bodyHtml: "<p>Hello {{firstName}}, we would love to connect.</p>",
              bodyText: "Hello {{firstName}}, we would love to connect.",
            },
          },
          {
            id: "step-1",
            campaignId,
            stepIndex: 1,
            purpose: "Add Value & Proof",
            delayDays: 3,
            delayBusinessDaysOnly: true,
            subjectMode: "THREADED",
            customSubject: null,
            templateId: template1Id,
            template: {
              id: template1Id,
              name: "Follow-up Proof",
              subject: "Quick thought on guest engagement",
              bodyHtml: "<p>Hi {{firstName}}, following up with quick proof.</p>",
              bodyText: "Hi {{firstName}}, following up with quick proof.",
            },
          },
        ],
      } as any;
    });

    // Mock initial send (Step 0)
    const mockStep0Send = {
      id: "send-step-0",
      campaignId,
      email: recipientEmail,
      contactId: "contact-1",
      subject: "FocusRealm Partnership for Grand Resort",
      html: "<p>Initial email</p>",
      text: "Initial email",
      messageId: step0MessageId,
      status: "SENT",
      stepIndex: 0,
      sentAt: new Date("2026-11-02T10:00:00Z"), // Monday
      campaign: {
        id: campaignId,
        fromName: "FocusRealm Founder's Office",
        automationMode: "APPROVAL_REQUIRED",
        sequenceSteps: [
          {
            stepIndex: 1,
            purpose: "Add Value & Proof",
            delayDays: 3,
            delayBusinessDaysOnly: true,
            subjectMode: "THREADED",
            templateId: template1Id,
            template: {
              id: template1Id,
              subject: "Quick thought on guest engagement",
              bodyHtml: "<p>Hi {{firstName}}, following up with quick proof.</p>",
              bodyText: "Hi {{firstName}}, following up with quick proof.",
            },
          },
        ],
      },
      contact: {
        id: "contact-1",
        firstName: "Vikram",
        company: "Grand Resort",
        email: recipientEmail,
      },
    };

    vi.spyOn(prisma.send, "findUnique").mockResolvedValue(mockStep0Send as any);
    vi.spyOn(prisma.suppressionEntry, "findUnique").mockResolvedValue(null);

    let createdFollowUpSend: any = null;
    (vi.spyOn(prisma.send, "upsert") as any).mockImplementation(async (args: any) => {
      createdFollowUpSend = args.create;
      return createdFollowUpSend;
    });

    let updatedRecipientState: any = null;
    (vi.spyOn(prisma.campaignRecipientState, "upsert") as any).mockImplementation(async (args: any) => {
      updatedRecipientState = args.update;
      return { id: "state-1", ...args.update };
    });
    vi.spyOn(prisma.campaignRecipientState, "findUnique").mockResolvedValue({
      id: "state-1",
      campaignId,
      email: recipientEmail,
      state: "PENDING_INITIAL",
    } as any);

    // 2. Trigger onStepSent for Step 0
    await onStepSent(mockStep0Send.id);

    // Verify Step 1 follow-up was created
    expect(createdFollowUpSend).toBeDefined();
    expect(createdFollowUpSend.stepIndex).toBe(1);
    expect(createdFollowUpSend.status).toBe("PENDING");
    // Threaded subject:
    expect(createdFollowUpSend.subject).toBe("Re: FocusRealm Partnership for Grand Resort");
    // In-reply-to Step 0's message ID:
    expect(createdFollowUpSend.inReplyToId).toBe(step0MessageId);
    // Scheduled for 3 business days later (Mon + 3 business days = Thu 2026-11-05):
    expect(createdFollowUpSend.scheduledFor.getUTCDate()).toBe(5);
    // In APPROVAL_REQUIRED mode, approvedAt MUST be null:
    expect(createdFollowUpSend.approvedAt).toBeNull();

    // Verify recipient state transitioned to AWAITING_APPROVAL
    expect(updatedRecipientState.state).toBe("AWAITING_APPROVAL");
    expect(updatedRecipientState.nextStepIndex).toBe(1);

    // 3. Test Approval
    (vi.spyOn(prisma.send, "findUnique") as any).mockImplementation(async (args: any) => {
      if (args.where?.id === createdFollowUpSend.id) {
        return createdFollowUpSend;
      }
      return mockStep0Send as any;
    });

    let approvedSendUpdate: any = null;
    vi.spyOn(prisma, "$transaction").mockImplementation(async (cb: any) => {
      const mockTx = {
        send: {
          update: vi.fn().mockImplementation((args: any) => {
            approvedSendUpdate = args.data;
            return Promise.resolve(args.data);
          }),
        },
        campaignRecipientState: {
          updateMany: vi.fn().mockResolvedValue({ count: 1 }),
        },
      };
      return cb(mockTx);
    });

    await approveFollowUpSend(campaignId, createdFollowUpSend.id);
    expect(approvedSendUpdate.approvedAt).toBeInstanceOf(Date);

    // 4. Test Reply Stopping Rule
    const updateManySendsSpy = vi.spyOn(prisma.send, "updateMany").mockResolvedValue({ count: 1 });
    const upsertStateSpy = vi.spyOn(prisma.campaignRecipientState, "upsert").mockResolvedValue({} as any);

    const cancelledCount = await stopSequenceForRecipient(
      campaignId,
      recipientEmail,
      "Reply received — automated outreach stopped",
      "REPLY_RECEIVED"
    );

    expect(cancelledCount).toBe(1);
    expect(updateManySendsSpy).toHaveBeenCalledWith({
      where: {
        campaignId,
        email: recipientEmail,
        status: { in: ["PENDING", "CLAIMED"] },
        stepIndex: { gt: 0 },
      },
      data: {
        status: "CANCELLED",
        skipReason: "Reply received — automated outreach stopped",
      },
    });
    expect(upsertStateSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { campaignId_email: { campaignId, email: recipientEmail } },
        update: expect.objectContaining({
          state: "REPLY_RECEIVED",
        }),
      })
    );
  });
});
