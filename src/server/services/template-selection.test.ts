import { describe, expect, it } from "vitest";
import {
  selectTemplateForRecipient,
  type EligibleTemplate,
  type RecipientProfile,
  type SelectionContext,
  type SelectionRule,
} from "./template-selection.js";

describe("template selection service", () => {
  const tGeneral: EligibleTemplate = {
    id: "t-general",
    name: "General Outreach",
    subject: "Hello {{firstName}}",
    bodyHtml: "<p>Hello</p>",
    version: 1,
    isFallback: true,
  };

  const tLuxuryGM: EligibleTemplate = {
    id: "t-luxury-gm",
    name: "Luxury GM Briefing",
    subject: "Luxury Strategy for {{company}}",
    bodyHtml: "<p>Luxury GM</p>",
    version: 1,
  };

  const tBoutique: EligibleTemplate = {
    id: "t-boutique",
    name: "Boutique Experience",
    subject: "Boutique Hospitality",
    bodyHtml: "<p>Boutique</p>",
    version: 1,
  };

  const tRevenue: EligibleTemplate = {
    id: "t-revenue",
    name: "RevPAR Maximization",
    subject: "RevPAR strategy",
    bodyHtml: "<p>Revenue</p>",
    version: 1,
  };

  const templates = [tGeneral, tLuxuryGM, tBoutique, tRevenue];

  it("selects fallback template when no rules match", () => {
    const recipient: RecipientProfile = {
      id: "c-1",
      email: "unknown@motel.test",
      hotelSegment: "BUDGET",
      contactPersona: "OTHER",
    };
    const context: SelectionContext = {
      templates,
      rules: [],
      defaultTemplateId: "t-general",
    };

    const result = selectTemplateForRecipient(recipient, context);
    expect(result.templateId).toBe("t-general");
    expect(result.assignmentSource).toBe("FALLBACK");
    expect(result.explanation).toContain("Fallback template: no rule matched");
  });

  it("selects template matching rule by segment and persona", () => {
    const recipient: RecipientProfile = {
      id: "c-2",
      email: "gm@luxury.test",
      hotelSegment: "LUXURY",
      contactPersona: "GENERAL_MANAGER",
    };
    const rule: SelectionRule = {
      id: "rule-1",
      templateId: "t-luxury-gm",
      priority: 1,
      hotelSegment: "LUXURY",
      contactPersona: "GENERAL_MANAGER",
      description: "Luxury GMs",
    };
    const context: SelectionContext = {
      templates,
      rules: [rule],
      defaultTemplateId: "t-general",
    };

    const result = selectTemplateForRecipient(recipient, context);
    expect(result.templateId).toBe("t-luxury-gm");
    expect(result.assignmentSource).toBe("RULE");
    expect(result.ruleId).toBe("rule-1");
    expect(result.explanation).toContain("Rule #1 (Luxury GMs): matched Segment 'LUXURY', Persona 'GENERAL_MANAGER'");
  });

  it("evaluates rules in order of priority (lower number first)", () => {
    const recipient: RecipientProfile = {
      id: "c-3",
      email: "gm@boutique.test",
      hotelSegment: "BOUTIQUE",
      contactPersona: "GENERAL_MANAGER",
    };
    // Rule 1: High priority matches BOUTIQUE
    const rule1: SelectionRule = {
      id: "rule-1",
      templateId: "t-boutique",
      priority: 1,
      hotelSegment: "BOUTIQUE",
      description: "Boutique Focus",
    };
    // Rule 2: Lower priority matches GENERAL_MANAGER
    const rule2: SelectionRule = {
      id: "rule-2",
      templateId: "t-luxury-gm",
      priority: 2,
      contactPersona: "GENERAL_MANAGER",
      description: "GM Focus",
    };

    // Even if array order is reversed, priority 1 must win
    const context: SelectionContext = {
      templates,
      rules: [rule2, rule1],
      defaultTemplateId: "t-general",
    };

    const result = selectTemplateForRecipient(recipient, context);
    expect(result.templateId).toBe("t-boutique");
    expect(result.rulePriority).toBe(1);
    expect(result.explanation).toContain("Rule #1 (Boutique Focus)");
  });

  it("respects requiresVerified and does not treat guesses as verified facts", () => {
    const guessedRecipient: RecipientProfile = {
      id: "c-4",
      email: "guess@hotel.test",
      hotelSegment: "LUXURY",
      hotelSegmentStatus: "GUESSED",
      hotelSegmentConfidence: 0.6,
      contactPersona: "GENERAL_MANAGER",
      contactPersonaStatus: "GUESSED",
    };
    const rule: SelectionRule = {
      id: "rule-verified",
      templateId: "t-luxury-gm",
      priority: 1,
      hotelSegment: "LUXURY",
      requiresVerified: true,
      description: "Verified Luxury Properties Only",
    };
    const context: SelectionContext = {
      templates,
      rules: [rule],
      defaultTemplateId: "t-general",
    };

    // Since recipient status is GUESSED, rule fails and recipient falls back to fallback template!
    const unverifiedResult = selectTemplateForRecipient(guessedRecipient, context);
    expect(unverifiedResult.templateId).toBe("t-general");
    expect(unverifiedResult.assignmentSource).toBe("FALLBACK");

    // Once verified by a person, rule matches!
    const verifiedRecipient: RecipientProfile = {
      ...guessedRecipient,
      hotelSegmentStatus: "VERIFIED",
      hotelSegmentConfidence: 1.0,
    };
    const verifiedResult = selectTemplateForRecipient(verifiedRecipient, context);
    expect(verifiedResult.templateId).toBe("t-luxury-gm");
    expect(verifiedResult.assignmentSource).toBe("RULE");
    expect(verifiedResult.explanation).toContain("[verified]");
  });

  it("enforces minConfidence threshold", () => {
    const lowConfidenceRecipient: RecipientProfile = {
      id: "c-5",
      email: "low@hotel.test",
      contactPersona: "REVENUE_MANAGER",
      contactPersonaConfidence: 0.4,
    };
    const rule: SelectionRule = {
      id: "rule-conf",
      templateId: "t-revenue",
      priority: 1,
      contactPersona: "REVENUE_MANAGER",
      minConfidence: 0.8,
    };
    const context: SelectionContext = {
      templates,
      rules: [rule],
      defaultTemplateId: "t-general",
    };

    // 0.4 < 0.8 -> falls back
    const result = selectTemplateForRecipient(lowConfidenceRecipient, context);
    expect(result.templateId).toBe("t-general");

    // 0.85 >= 0.8 -> matches
    const highConfResult = selectTemplateForRecipient(
      { ...lowConfidenceRecipient, contactPersonaConfidence: 0.85 },
      context
    );
    expect(highConfResult.templateId).toBe("t-revenue");
  });

  it("prioritizes manual override over rule matches with auditable explanation", () => {
    const recipient: RecipientProfile = {
      id: "c-6",
      email: "special@hotel.test",
      hotelSegment: "LUXURY",
      contactPersona: "GENERAL_MANAGER",
    };
    const rule: SelectionRule = {
      id: "rule-1",
      templateId: "t-luxury-gm",
      priority: 1,
      hotelSegment: "LUXURY",
    };
    const overrides = new Map([
      ["c-6", { contactId: "c-6", templateId: "t-boutique", reason: "Requested boutique angle on call" }],
    ]);

    const context: SelectionContext = {
      templates,
      rules: [rule],
      overrides,
      defaultTemplateId: "t-general",
    };

    const result = selectTemplateForRecipient(recipient, context);
    expect(result.templateId).toBe("t-boutique");
    expect(result.assignmentSource).toBe("OVERRIDE");
    expect(result.explanation).toBe("Manual override: Requested boutique angle on call");
  });

  describe("Targeting rules segregation & fallback verification (Co-partnerships, Hotels, Institutes)", () => {
    const tFallback: EligibleTemplate = {
      id: "tpl-default-fallback",
      name: "Default Fallback Template",
      subject: "Welcome to FocusRealm",
      bodyHtml: "<p>General Welcome</p>",
      version: 1,
      isFallback: true,
    };

    const tInstitute: EligibleTemplate = {
      id: "tpl-institute-hiring",
      name: "Institute & Campus Hiring Outreach",
      subject: "Campus Recruitment & Placement with FocusRealm",
      bodyHtml: "<p>Campus Hiring</p>",
      version: 1,
    };

    const tPartner: EligibleTemplate = {
      id: "tpl-co-partner",
      name: "Strategic Co-Partnership Proposal",
      subject: "Strategic Brand Alliances & Collaboration",
      bodyHtml: "<p>Partnership</p>",
      version: 1,
    };

    const tHotel: EligibleTemplate = {
      id: "tpl-hotel-properties",
      name: "Hotel & Resort Solutions",
      subject: "Guest Experience for {{company}}",
      bodyHtml: "<p>Hotel</p>",
      version: 1,
    };

    const segregationTemplates = [tFallback, tInstitute, tPartner, tHotel];

    const rules: SelectionRule[] = [
      {
        id: "rule-institutes",
        templateId: "tpl-institute-hiring",
        priority: 1,
        hotelSegment: "INSTITUTE",
        description: "Target Campus Institutes & Colleges",
      },
      {
        id: "rule-partners",
        templateId: "tpl-co-partner",
        priority: 2,
        hotelSegment: "CO_PARTNERSHIP",
        description: "Target Strategic Co-Partnerships",
      },
      {
        id: "rule-hotels",
        templateId: "tpl-hotel-properties",
        priority: 3,
        hotelSegment: "HOTEL",
        description: "Target All Hotel & Resort Properties",
      },
    ];

    const context: SelectionContext = {
      templates: segregationTemplates,
      rules,
      defaultTemplateId: "tpl-default-fallback",
    };

    it("automatically segregates Institute contact to Institute Hiring template", () => {
      const instituteContact: RecipientProfile = {
        id: "contact-ihm",
        email: "tpo@ihm-mumbai.edu",
        company: "IHM Mumbai",
        hotelSegment: "INSTITUTE",
        contactPersona: "PLACEMENT_OFFICER",
      };

      const result = selectTemplateForRecipient(instituteContact, context);
      expect(result.templateId).toBe("tpl-institute-hiring");
      expect(result.assignmentSource).toBe("RULE");
      expect(result.ruleId).toBe("rule-institutes");
      expect(result.explanation).toContain("matched Segment 'INSTITUTE'");
    });

    it("automatically segregates Co-partnership contact to Co-partnership template", () => {
      const partnerContact: RecipientProfile = {
        id: "contact-partner",
        email: "alliances@traveltech.io",
        company: "TravelTech Alliances",
        hotelSegment: "CO_PARTNERSHIP",
        contactPersona: "PARTNERSHIP_DIRECTOR",
      };

      const result = selectTemplateForRecipient(partnerContact, context);
      expect(result.templateId).toBe("tpl-co-partner");
      expect(result.assignmentSource).toBe("RULE");
      expect(result.ruleId).toBe("rule-partners");
      expect(result.explanation).toContain("matched Segment 'CO_PARTNERSHIP'");
    });

    it("automatically segregates any hotel property (LUXURY, RESORT, BOUTIQUE) to the Hotel template", () => {
      const luxuryHotelContact: RecipientProfile = {
        id: "contact-luxury-hotel",
        email: "gm@tajpalace.test",
        company: "Taj Lake Palace",
        hotelSegment: "LUXURY",
        contactPersona: "GENERAL_MANAGER",
      };

      const resortContact: RecipientProfile = {
        id: "contact-resort",
        email: "ops@goaresort.test",
        company: "Goa Beach Resort",
        hotelSegment: "RESORT",
      };

      const result1 = selectTemplateForRecipient(luxuryHotelContact, context);
      expect(result1.templateId).toBe("tpl-hotel-properties");
      expect(result1.assignmentSource).toBe("RULE");
      expect(result1.ruleId).toBe("rule-hotels");

      const result2 = selectTemplateForRecipient(resortContact, context);
      expect(result2.templateId).toBe("tpl-hotel-properties");
      expect(result2.assignmentSource).toBe("RULE");
    });

    it("routes unmatched contacts cleanly to default fallback without error", () => {
      const unmatchedContact: RecipientProfile = {
        id: "contact-general",
        email: "alex@genericcorp.test",
        company: "Generic Logistics Corp",
        hotelSegment: "UNKNOWN",
        contactPersona: "OTHER",
      };

      const result = selectTemplateForRecipient(unmatchedContact, context);
      expect(result.templateId).toBe("tpl-default-fallback");
      expect(result.assignmentSource).toBe("FALLBACK");
      expect(result.explanation).toContain("Fallback template");
    });

    it("automatically infers and segregates Concierge Collective partner and MMR Hotels even when DB segment is null", () => {
      // Real-world scenario from user screenshot:
      // Contact has no segment pre-populated in database:
      const conciergePartner: RecipientProfile = {
        id: "contact-concierge",
        email: "kashish@conciergecollective.in",
        company: "Concierge Collective",
        hotelSegment: null,
      };

      const mmrHotelContact: RecipientProfile = {
        id: "contact-mmr",
        email: "rohit.t@mmrhotels.com",
        company: "MMR Hotels",
        title: "Owner",
        hotelSegment: null,
      };

      // Concierge Collective is classified as CO_PARTNERSHIP and receives the Co-partnership template
      const partnerResult = selectTemplateForRecipient(conciergePartner, context);
      expect(partnerResult.templateId).toBe("tpl-co-partner");
      expect(partnerResult.explanation).toContain("CO_PARTNERSHIP");

      // MMR Hotels is classified as hotel and receives the Hotel template
      const hotelResult = selectTemplateForRecipient(mmrHotelContact, context);
      expect(hotelResult.templateId).toBe("tpl-hotel-properties");
      expect(hotelResult.explanation).toContain("Hotels & Hospitality");
    });

    it("protects partners from being assigned a Hiring Placement template when no explicit rules are defined", () => {
      // Scenario: Campaign has multiple templates, but user has NOT created manual rules yet.
      // Default fallback happens to be 'tpl-institute-hiring'.
      const contextWithoutRules: SelectionContext = {
        templates: segregationTemplates,
        rules: [],
        defaultTemplateId: "tpl-institute-hiring",
      };

      const partnerContact: RecipientProfile = {
        id: "contact-partner",
        email: "kashish@conciergecollective.in",
        company: "Concierge Collective",
        hotelSegment: null,
      };

      const result = selectTemplateForRecipient(partnerContact, contextWithoutRules);
      // Smart audience vertical routing automatically assigns the Co-Partnership template
      expect(result.templateId).toBe("tpl-co-partner");
      expect(result.explanation).toContain("Co-Partnership");
      // Under no circumstances should the hiring template be assigned to a partner
      expect(result.templateId).not.toBe("tpl-institute-hiring");
    });

    it("priority order dictates template assignment when rules overlap without manual segregation", () => {
      // Overlapping scenario: Contact has hotelSegment "INSTITUTE" and persona "PARTNERSHIP_DIRECTOR"
      const dualMatchContact: RecipientProfile = {
        id: "contact-dual",
        email: "dean.partnerships@ihm.test",
        company: "National Hospitality Institute",
        hotelSegment: "INSTITUTE",
        contactPersona: "PARTNERSHIP_DIRECTOR",
      };

      // With Rule 1 (Priority 1) = INSTITUTE and Rule 2 (Priority 2) = PARTNERSHIP_DIRECTOR
      const dualRules: SelectionRule[] = [
        {
          id: "rule-institute-first",
          templateId: "tpl-institute-hiring",
          priority: 1,
          hotelSegment: "INSTITUTE",
        },
        {
          id: "rule-partner-second",
          templateId: "tpl-co-partner",
          priority: 2,
          contactPersona: "PARTNERSHIP_DIRECTOR",
        },
      ];

      const res1 = selectTemplateForRecipient(dualMatchContact, {
        ...context,
        rules: dualRules,
      });
      expect(res1.templateId).toBe("tpl-institute-hiring");
      expect(res1.rulePriority).toBe(1);

      // When user moves priority up/down so Partner is Priority 1:
      const reorderedRules: SelectionRule[] = [
        {
          id: "rule-partner-second",
          templateId: "tpl-co-partner",
          priority: 1,
          contactPersona: "PARTNERSHIP_DIRECTOR",
        },
        {
          id: "rule-institute-first",
          templateId: "tpl-institute-hiring",
          priority: 2,
          hotelSegment: "INSTITUTE",
        },
      ];

      const res2 = selectTemplateForRecipient(dualMatchContact, {
        ...context,
        rules: reorderedRules,
      });
      expect(res2.templateId).toBe("tpl-co-partner");
      expect(res2.rulePriority).toBe(1);
    });
  });
});
