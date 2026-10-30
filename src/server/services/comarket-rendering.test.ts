import { describe, it, expect } from "vitest";
import { contactMergeData, renderEmail, validateTemplate } from "../../shared/merge.js";
import { buildStarterTemplate, type WriterTone } from "../../shared/template-writer.js";
import { cleanResearchNotes, normalizeFirstName } from "../../shared/contact-normalizer.js";
import {
  understandRecipientCompany,
  reasonPartnershipOpportunity,
  synthesizeRecipientPersonalization,
} from "../../shared/partner-intelligence.js";

export const TEST_CONTACTS = [
  {
    company: "Concierge Collective",
    firstName: "Kashish",
    lastName: null,
    email: "kashish@conciergecollective.in",
    title: null,
    customFields: {
      aboutCompany:
        "A Delhi-based hospitality creative agency working with hotels and resorts across India on marketing, PR, events, content, influencer campaigns and hotel roadshows.",
      partnershipOpportunity:
        "Co-market “Guest Experience Beyond the Booking” and offer Focus Realm as an operational-readiness add-on for hotel clients. Validate active hotel-account count and willingness to make direct introductions.",
    },
  },
  {
    company: "GrowGuest",
    firstName: "Founder",
    lastName: "/ Contact team",
    email: "hello@growguest.com",
    title: "Founder / Marketing Partnerships",
    customFields: {
      aboutCompany:
        "A founder-led hospitality marketing consultancy focused on independent properties and resorts, including clients in Maharashtra and Uttarakhand. Its services combine digital marketing with hotel-operations experience.",
      partnershipOpportunity:
        "Launch a “More Bookings, Better Operations” offer: GrowGuest performs a direct-booking audit and Focus Realm runs an operations pilot. Founder-led structure should support a fast partnership test; validate active client count.",
    },
  },
  {
    company: "RevOpt Global",
    firstName: "Amit",
    lastName: "Kapoor",
    email: "amit@revoptglobal.com",
    title: "Director of Revenue Strategy",
    customFields: {
      aboutCompany:
        "Hotel revenue management, dynamic pricing algorithms, and distribution strategy consulting for upscale and boutique hotels across South Asia.",
      partnershipOpportunity:
        "Pair revenue management optimization with frontline operational consistency to protect guest ratings and ADR.",
    },
  },
  {
    company: "RIE — Real Time Insight Engine",
    firstName: "Rohit",
    lastName: "Verma",
    email: "rohit@rie-feedback.io",
    title: "Head of Product",
    customFields: {
      aboutCompany:
        "Real-time guest sentiment tracking, guest feedback analytics, and hotel review monitoring platform for luxury resorts and hotel chains.",
      partnershipOpportunity:
        "Connect guest sentiment insights with frontline corrective workflows in Mise Hotel to close service gaps before checkout.",
    },
  },
  {
    company: "HTI India",
    firstName: "Dominic",
    lastName: "Costa",
    email: "dominic@hti-india.com",
    title: "Founder & Director",
    customFields: {
      aboutCompany:
        "HTI provides customized training for hospitality staff, including in-person and brand-specific programs. Its website describes work with partner brands to create training programs and operational learning infrastructure.",
      partnershipOpportunity: "HTI teaches employees how to perform (LMS) we Verify Service execution (LTS)",
    },
  },
  {
    company: "Webvi Solutions",
    firstName: "Vivek",
    lastName: "Shah",
    email: "vivek@webvi.in",
    title: "Founder & Chief Technology Officer",
    customFields: {
      aboutCompany:
        "Webvi describes itself as a hospitality-specific recruitment and job-placement platform serving hotels, resorts, restaurants and hospitality professionals.",
      partnershipOpportunity: "Hospitality Recruitment agency we help Maintain the quality",
    },
  },
  {
    company: "CleanGreen Commercial Laundry",
    firstName: "Sanjay",
    lastName: "Mehra",
    email: "sanjay@cleangreenlaundry.com",
    title: "Managing Partner",
    customFields: {
      aboutCompany:
        "Commercial laundry and linen management services for regional hotels and healthcare facilities.",
      partnershipOpportunity:
        "Explore potential mutual synergies for hotel clients.",
    },
  },
];

describe("Contact Normalization & Research Cleaning", () => {
  it("normalizes generic first names to undefined so fallbacks work cleanly", () => {
    expect(normalizeFirstName("Founder", "/ Contact team")).toBeUndefined();
    expect(normalizeFirstName("admin", null)).toBeUndefined();
    expect(normalizeFirstName("Team", null)).toBeUndefined();
    expect(normalizeFirstName("Contact", null)).toBeUndefined();
    expect(normalizeFirstName(null, null)).toBeUndefined();

    // Real human names are preserved
    expect(normalizeFirstName("Kashish", null)).toBe("Kashish");
    expect(normalizeFirstName("Dominic", "Costa")).toBe("Dominic");
    expect(normalizeFirstName("Vivek", "Shah")).toBe("Vivek");
    expect(normalizeFirstName("Amit", "Kapoor")).toBe("Amit");
    expect(normalizeFirstName("Rohit", "Verma")).toBe("Rohit");
    expect(normalizeFirstName("Sanjay", "Mehra")).toBe("Sanjay");
  });

  it("strips internal qualification notes and directives from partnershipOpportunity", () => {
    const raw1 =
      "Co-market “Guest Experience Beyond the Booking” and offer Focus Realm as an operational-readiness add-on for hotel clients. Validate active hotel-account count and willingness to make direct introductions.";
    const clean1 = cleanResearchNotes(raw1);
    expect(clean1).not.toMatch(/validate active/i);
    expect(clean1).not.toMatch(/willingness to make/i);
    expect(clean1).toContain("Guest Experience Beyond the Booking");

    const raw2 =
      "Launch a “More Bookings, Better Operations” offer: GrowGuest performs a direct-booking audit and Focus Realm runs an operations pilot. Founder-led structure should support a fast partnership test; validate active client count.";
    const clean2 = cleanResearchNotes(raw2);
    expect(clean2).not.toMatch(/validate active client count/i);
    expect(clean2).not.toMatch(/founder-led structure/i);
    expect(clean2).toContain("More Bookings, Better Operations");

    const raw3 =
      "Run a joint hotel-performance assessment covering revenue leakage and operational inconsistency. Request the current managed-property count before prioritizing the partnership.";
    const clean3 = cleanResearchNotes(raw3);
    expect(clean3).not.toMatch(/request the current/i);
    expect(clean3).not.toMatch(/before prioritizing/i);
    expect(clean3).toContain("joint hotel-performance assessment");
  });
});

describe("Multi-Stage Partner Intelligence Engine", () => {
  it("accurately understands each company and deduces distinct, non-overlapping complementary angles", () => {
    // 1. Concierge Collective
    const p1 = synthesizeRecipientPersonalization(TEST_CONTACTS[0]!);
    expect(p1.understanding.domain).toBe("marketing_agency");
    expect(p1.understanding.coreActivity).toMatch(/marketing|pr|events|content/i);
    expect(p1.reasoning.complementaryAngle).toMatch(/visibility|guest acquisition/i);
    expect(p1.reasoning.partnershipProposal).toContain("Guest Experience Beyond the Booking");

    // 2. GrowGuest
    const p2 = synthesizeRecipientPersonalization(TEST_CONTACTS[1]!);
    expect(p2.understanding.domain).toBe("marketing_agency");
    expect(p2.mergeData.firstName).toBeUndefined(); // Normalized from "Founder"
    expect(p2.reasoning.partnershipProposal).toContain("More Bookings, Better Operations");

    // 3. RevOpt Global
    const p3 = synthesizeRecipientPersonalization(TEST_CONTACTS[2]!);
    expect(p3.understanding.domain).toBe("revenue_management");
    expect(p3.reasoning.complementaryAngle).toMatch(/revenue|pricing|distribution/i);
    expect(p3.reasoning.complementaryAngle).toMatch(/operational consistency/i);

    // 4. RIE — Real Time Insight Engine
    const p4 = synthesizeRecipientPersonalization(TEST_CONTACTS[3]!);
    expect(p4.understanding.domain).toBe("guest_analytics");
    expect(p4.reasoning.complementaryAngle).toMatch(/sentiment|feedback/i);
    expect(p4.reasoning.complementaryAngle).toMatch(/frontline/i);

    // 5. HTI India
    const p5 = synthesizeRecipientPersonalization(TEST_CONTACTS[4]!);
    expect(p5.understanding.domain).toBe("staff_training");
    expect(p5.reasoning.complementaryAngle).toMatch(/training|standards/i);
    expect(p5.reasoning.complementaryAngle).toMatch(/verified/i);

    // 6. Webvi Solutions
    const p6 = synthesizeRecipientPersonalization(TEST_CONTACTS[5]!);
    expect(p6.understanding.domain).toBe("talent_recruitment");
    expect(p6.reasoning.complementaryAngle).toMatch(/recruitment|hiring|talent/i);

    // 7. CleanGreen Commercial Laundry (Unfamiliar Generalization Test)
    const p7 = synthesizeRecipientPersonalization(TEST_CONTACTS[6]!);
    expect(p7.understanding.domain).toBe("unfamiliar_domain");
    expect(p7.reasoning.isCautious).toBe(true);
    expect(p7.reasoning.complementaryAngle).toMatch(/Mise Hotel platform/i);
    expect(p7.reasoning.complementaryAngle).toMatch(/without any operational overlap/i);
    expect(p7.reasoning.partnershipProposal).toMatch(/introductory discussion|mutual synergies/i);
  });
});

describe("Rendered Email Verification Across All 7 Partners", () => {
  const tones: WriterTone[] = ["warm", "professional", "concise", "upbeat"];

  for (const tone of tones) {
    describe(`Tone: ${tone}`, () => {
      const draft = buildStarterTemplate({
        goal: "co_market",
        tone,
        fields: [
          { name: "firstName", label: "First name", coverage: 0.8, custom: false },
          { name: "company", label: "Company", coverage: 1, custom: false },
          { name: "aboutCompany", label: "aboutCompany", coverage: 1, custom: true },
          { name: "partnershipOpportunity", label: "partnershipOpportunity", coverage: 1, custom: true },
        ],
      });

      it("template passes validation with no syntax errors", () => {
        expect(validateTemplate({ subject: draft.subject, bodyHtml: draft.body })).toEqual([]);
      });

      for (const contact of TEST_CONTACTS) {
        it(`renders clean, personalized email for ${contact.company} without internal notes leaking`, () => {
          const data = contactMergeData(contact);
          const rendered = renderEmail({ subject: draft.subject, bodyHtml: draft.body, bodyText: draft.body }, data);

          expect(rendered.missingFields).toEqual([]);
          const fullText = `${rendered.subject}\n${rendered.text}`;

          // 1. Internal notes must NEVER leak
          expect(fullText).not.toMatch(/validate active/i);
          expect(fullText).not.toMatch(/willingness to make/i);
          expect(fullText).not.toMatch(/managed-property count/i);
          expect(fullText).not.toMatch(/founder-led structure/i);

          // 2. Greetings must be proper
          if (contact.company === "GrowGuest") {
            expect(fullText).not.toMatch(/hello founder/i);
            expect(fullText).not.toMatch(/hi founder/i);
            expect(fullText).toMatch(/there|GrowGuest Team/i);
          } else if (contact.firstName) {
            expect(fullText).toContain(contact.firstName);
          }

          // 3. Sender identity & Branding consistency
          expect(fullText).not.toMatch(/Demo Founder/i);
          expect(fullText).not.toMatch(/Focus Realm\b/); // Must never have a space
          expect(fullText).toMatch(/FocusRealm/);
          expect(fullText).toMatch(/Founder’s Office|Founder's Office/);

          // 4. No unreplaced merge tags
          expect(fullText).not.toMatch(/\{\{[^}]*\}\}/);
          expect(fullText).not.toMatch(/\{[a-zA-Z_]+\|/);

          // 5. Concise summaries — never insert raw multi-line research paragraphs
          expect(String(data.aboutCompany).length).toBeLessThan(120);
          expect(String(data.partnershipOpportunity).length).toBeLessThan(160);
        });
      }
    });
  }

  it("blocks and flags empty or malformed fallback tokens like {{firstName|}} or {firstName| }", () => {
    const broken1 = { subject: "Test", bodyHtml: "<p>Hi {{firstName|}}</p>", bodyText: "Hi {{firstName|}}" };
    const errs1 = validateTemplate(broken1);
    expect(errs1.length).toBeGreaterThan(0);
    expect(errs1.join(" ")).toMatch(/empty fallback/i);

    const brokenSingle = { subject: "Test", bodyHtml: "<p>Hi {firstName|there}</p>", bodyText: "Hi {firstName|there}" };
    const errs2 = validateTemplate(brokenSingle);
    expect(errs2.length).toBeGreaterThan(0);
    expect(errs2.join(" ")).toMatch(/single-brace/i);
  });

  it("strips Demo Founder and replaces 'Focus Realm' with 'FocusRealm' in renderEmail", () => {
    const rawTemplate = {
      subject: "Partnership with Focus Realm",
      bodyHtml: "<p>Hi {{firstName|there}},</p><p>We are Focus Realm.</p><p>Best wishes,<br>Demo Founder<br>Founder’s Office<br>Focus Realm</p>",
      bodyText: "Hi {{firstName|there}},\n\nWe are Focus Realm.\n\nBest wishes,\nDemo Founder\nFounder’s Office\nFocus Realm",
    };
    const rendered = renderEmail(rawTemplate, { firstName: "Kashish" });
    expect(rendered.subject).toBe("Partnership with FocusRealm");
    expect(rendered.text).not.toContain("Demo Founder");
    expect(rendered.text).not.toContain("Focus Realm");
    expect(rendered.text).toContain("FocusRealm");
    expect(rendered.html).not.toContain("Demo Founder");
    expect(rendered.html).not.toContain("Focus Realm");
    expect(rendered.html).toContain("FocusRealm");
  });
});
