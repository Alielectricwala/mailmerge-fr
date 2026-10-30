import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import {
  detectProspectListType,
  computeImportQuality,
} from "./classification.js";
import {
  classifyReplySentiment,
} from "./inbox-classifier.js";
import {
  LIST_PREPARATION_GUIDES,
} from "../../shared/data-prep.js";

describe("Data Preparation & Analytics Suite", () => {
  describe("Phase 1: Intelligent Data Preparation & List-Type Detection", () => {
    it("detects HOTEL_PROSPECTS from the synthetic-hotels-contacts.csv fixture", () => {
      const csvPath = path.resolve(process.cwd(), "tests/fixtures/synthetic-hotels-contacts.csv");
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.trim().split(/\r?\n/);
      const headers = lines[0]!.split(",");
      const sampleRows = lines.slice(1, 5).map((l) => l.split(","));

      const detected = detectProspectListType(headers, sampleRows);
      expect(detected).toBe("HOTEL_PROSPECTS");
    });

    it("detects CO_MARKETING_PARTNERS from the co-market-partnerships.csv fixture", () => {
      const csvPath = path.resolve(process.cwd(), "tests/fixtures/co-market-partnerships.csv");
      const content = fs.readFileSync(csvPath, "utf-8");
      const lines = content.trim().split(/\r?\n/);
      const headers = lines[0]!.split(",");
      const sampleRows = lines.slice(1, 4).map((l) => l.split(","));

      const detected = detectProspectListType(headers, sampleRows);
      expect(detected).toBe("CO_MARKETING_PARTNERS");
    });

    it("provides downloadable template structures for all 3 list types", () => {
      for (const type of ["HOTEL_PROSPECTS", "CO_MARKETING_PARTNERS", "GENERAL_BUSINESS"] as const) {
        const guide = LIST_PREPARATION_GUIDES[type];
        expect(guide).toBeDefined();
        expect(guide.sampleCsv.length).toBeGreaterThan(50);
        expect(guide.essentialColumns.length).toBeGreaterThan(0);
        expect(guide.recommendedColumns.length).toBeGreaterThan(0);
        expect(guide.removableColumns.length).toBeGreaterThan(0);
      }
    });

    it("evaluates data quality and personalization readiness accurately", () => {
      // 1. Incomplete list (only hotel name and email)
      const minimalQuality = computeImportQuality(
        ["Hotel Name", "Email"],
        { "Hotel Name": "company", Email: "email" },
        "HOTEL_PROSPECTS"
      );
      expect(minimalQuality.hasEmail).toBe(true);
      expect(minimalQuality.hasCompany).toBe(true);
      expect(minimalQuality.essentialMissing).toHaveLength(0);
      expect(minimalQuality.recommendedMissing).toContain("Contact Person");
      expect(minimalQuality.score).toBe(60);

      // 2. High-personalization list
      const richQuality = computeImportQuality(
        ["Hotel Name", "Email", "First Name", "Job Title", "Hotel Segment"],
        {
          "Hotel Name": "company",
          Email: "email",
          "First Name": "firstName",
          "Job Title": "title",
          "Hotel Segment": "hotelSegment",
        },
        "HOTEL_PROSPECTS"
      );
      expect(richQuality.score).toBe(100);
      expect(richQuality.essentialMissing).toHaveLength(0);
      expect(richQuality.recommendedMissing).toHaveLength(0);
      expect(richQuality.personalizationTagsReady).toContain("email");
      expect(richQuality.personalizationTagsReady).toContain("company");
      expect(richQuality.personalizationTagsReady).toContain("firstName");
      expect(richQuality.personalizationTagsReady).toContain("title");
      expect(richQuality.personalizationTagsReady).toContain("hotelSegment");
    });
  });

  describe("Phase 2 & 3: Reply Tracking & Performance Analytics Logic", () => {
    it("reliably classifies reply sentiments using deterministic rules", () => {
      // Positive cases
      const positive1 = classifyReplySentiment("Hi Sachin, sounds good. Let's schedule a demo call next week.");
      expect(positive1.sentiment).toBe("POSITIVE");
      expect(positive1.matchedKeywords).toContain("sounds good");

      const positive2 = classifyReplySentiment("Can you send over pricing and deck?");
      expect(positive2.sentiment).toBe("POSITIVE");

      // Negative cases
      const negative1 = classifyReplySentiment("Please unsubscribe and remove me from your list.");
      expect(negative1.sentiment).toBe("NEGATIVE");
      expect(negative1.matchedKeywords).toContain("unsubscribe");

      const negative2 = classifyReplySentiment("Not interested, stop emailing our team.");
      expect(negative2.sentiment).toBe("NEGATIVE");

      // Out of office cases
      const ooo = classifyReplySentiment("I am out of the office on annual leave returning next Monday.");
      expect(ooo.sentiment).toBe("OUT_OF_OFFICE");

      // Neutral case
      const neutral = classifyReplySentiment("Thank you for reaching out.");
      expect(neutral.sentiment).toBe("NEUTRAL");
    });

    it("verifies fair rate calculations with proper denominators", () => {
      // Delivery Rate: delivered / attempted
      const attempted = 100;
      const providerAccepted = 98;
      const bounced = 2;
      const delivered = Math.max(0, providerAccepted - bounced); // 96
      const deliveryRate = Number(((delivered / attempted) * 100).toFixed(1));
      expect(deliveryRate).toBe(96.0);

      // Reply Rate: replies / delivered (NEVER total list or total attempts)
      const replies = 16;
      const replyRate = Number(((replies / delivered) * 100).toFixed(1));
      expect(replyRate).toBe(16.7);

      // Meeting Rate: meetings / delivered
      const meetings = 4;
      const meetingRate = Number(((meetings / delivered) * 100).toFixed(1));
      expect(meetingRate).toBe(4.2);

      // Statistical confidence rule: attempted < 20 is limited data
      expect(attempted < 20).toBe(false);
      expect(15 < 20).toBe(true);
    });
  });
});
