import { describe, it, expect } from "vitest";
import { classifyIncoming, classifyReplySentiment, type IncomingMessage } from "./inbox-classifier.js";

const base: IncomingMessage = { from: "", subject: "", headers: {}, text: "", attachments: [], date: new Date() };
const DOMAIN = "misehotel.com";
const OUR_ID = "<3f1c2a90-aaaa-bbbb-cccc-111122223333@misehotel.com>";

describe("classifyIncoming", () => {
  it("reads a standard DSN as a hard bounce with recipient and original Message-ID", () => {
    const result = classifyIncoming(
      {
        ...base,
        from: "Mail Delivery System <MAILER-DAEMON@mail.spacemail.com>",
        subject: "Undelivered Mail Returned to Sender",
        headers: { "content-type": 'multipart/report; report-type=delivery-status; boundary="x"' },
        attachments: [
          { contentType: "message/delivery-status", content: "Final-Recipient: rfc822; ghost@example.com\nAction: failed\nStatus: 5.1.1\nDiagnostic-Code: smtp; 550 5.1.1 <ghost@example.com>: Recipient address rejected: User unknown" },
          { contentType: "text/rfc822-headers", content: `Message-ID: ${OUR_ID}\nSubject: Hello` },
        ],
      },
      DOMAIN
    );
    expect(result).toEqual({
      type: "bounce",
      hard: true,
      recipient: "ghost@example.com",
      messageIds: [OUR_ID],
      diagnostic: "550 5.1.1 <ghost@example.com>: Recipient address rejected: User unknown",
    });
  });

  it("treats 4.x.x status as a soft bounce", () => {
    const r = classifyIncoming(
      { ...base, from: "MAILER-DAEMON@x", subject: "Delivery Status Notification (Delay)", attachments: [{ contentType: "message/delivery-status", content: "Status: 4.4.7\nAction: delayed" }] },
      DOMAIN
    );
    expect(r).toMatchObject({ type: "bounce", hard: false });
  });

  it("matches a human reply by In-Reply-To and strips the quoted part", () => {
    const r = classifyIncoming(
      { ...base, from: "ana@x.com", subject: "Re: Hello", headers: { "in-reply-to": OUR_ID }, text: "Sounds great, let's talk Tuesday.\n\nOn Mon, 3 Nov 2026 at 10:00, FocusRealm wrote:\n> Hello" },
      DOMAIN
    );
    expect(r).toEqual({ type: "reply", messageIds: [OUR_ID], snippet: "Sounds great, let's talk Tuesday." });
  });

  it("recognizes out-of-office replies", () => {
    const r = classifyIncoming({ ...base, subject: "Out of Office: Hello", headers: { "in-reply-to": OUR_ID, "auto-submitted": "auto-replied" } }, DOMAIN);
    expect(r.type).toBe("auto_reply");
  });

  it("ignores mail that doesn't reference our messages", () => {
    expect(classifyIncoming({ ...base, subject: "Invoice", headers: { "in-reply-to": "<abc@other.com>" } }, DOMAIN).type).toBe("other");
  });
});

describe("classifyReplySentiment", () => {
  it("classifies enthusiastic responses as POSITIVE", () => {
    const res = classifyReplySentiment("Hi Sachin, sounds good. Let's schedule a call for next Tuesday.", "Re: Quality audits");
    expect(res.sentiment).toBe("POSITIVE");
    expect(res.confidence).toBeGreaterThan(0.7);
  });

  it("classifies opt-outs as NEGATIVE", () => {
    const res = classifyReplySentiment("Please unsubscribe and remove me from your list.", "Re: Partnership");
    expect(res.sentiment).toBe("NEGATIVE");
    expect(res.confidence).toBeGreaterThan(0.7);
  });

  it("classifies vacation and away notices as OUT_OF_OFFICE", () => {
    const res = classifyReplySentiment("I am currently away on annual leave returning on Friday.", "Automatic reply: Hello");
    expect(res.sentiment).toBe("OUT_OF_OFFICE");
  });

  it("classifies ambiguous responses as NEUTRAL", () => {
    const res = classifyReplySentiment("Thanks for the message.", "Re: Hello");
    expect(res.sentiment).toBe("NEUTRAL");
  });
});

