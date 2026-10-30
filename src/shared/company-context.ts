// Centralized, authoritative context for FocusRealm and Mise Hotel.
// Reused across email generation, partner intelligence, and template rendering.
// Grounded strictly in authentic company facts — never fabricated.

export interface CompanyContext {
  name: string;
  legalName: string;
  brandName: string;
  tagline: string;
  flagshipProduct: {
    name: string;
    url: string;
    category: string;
    problemSolved: string;
    coreCapabilities: string[];
    targetCustomers: string[];
  };
  leadership: {
    founderName: string;
    founderTitle: string;
    officeSignOff: string;
  };
  webPresence: {
    platformUrl: string;
    companyUrl: string;
  };
  partnershipPhilosophy: {
    corePrinciple: string;
    hospitalityValueAdd: string;
  };
}

export const FOCUSREALM_CONTEXT: CompanyContext = {
  name: "FocusRealm",
  legalName: "FocusRealm",
  brandName: "FocusRealm",
  tagline: "Empowering hospitality teams with verified frontline service execution",
  flagshipProduct: {
    name: "Mise Hotel",
    url: "https://misehotel.com/",
    category: "Hospitality Service Execution Platform",
    problemSolved:
      "Bridging the execution gap in hotels between corporate SOPs, training manuals, and brand audits on one side, and actual daily frontline execution by staff across departments and shifts on the other.",
    coreCapabilities: [
      "Translates complex corporate SOPs, checklists, and brand standards into mobile workflows assigned to frontline staff",
      "Captures verifiable completion evidence (checklists, timestamps, photo proofs) for operational accountability",
      "Provides real-time operational oversight and audit compliance metrics for general managers and hotel owners",
      "Ensures SOPs and service standards defined at leadership level are consistently executed on property",
    ],
    targetCustomers: [
      "Independent boutique hotels and luxury resorts",
      "Hotel management companies and regional hospitality groups",
      "Full-service properties with multi-department frontline teams",
    ],
  },
  leadership: {
    founderName: "Sehej Sharma",
    founderTitle: "Founder & CEO",
    officeSignOff: "Founder’s Office\nFocusRealm\nhttps://misehotel.com/\nhttps://focusrealm.org/",
  },
  webPresence: {
    platformUrl: "https://misehotel.com/",
    companyUrl: "https://focusrealm.org/",
  },
  partnershipPhilosophy: {
    corePrinciple:
      "FocusRealm does not replace partners' core services (marketing, recruitment, LMS, or revenue consulting). Instead, Mise Hotel acts as an operational execution complement that protects and amplifies the partner's results.",
    hospitalityValueAdd:
      "While partners deliver guest acquisition, staff training, talent hiring, pricing optimization, or technology systems, FocusRealm ensures on-property frontline service execution and operational consistency once guests arrive.",
  },
};
