// Partner Intelligence Engine
// Multi-stage reasoning pipeline:
// Stage 1: Recipient Company Understanding (what they actually do, offerings, customer value)
// Stage 2: Partnership Reasoning (how they realistically complement FocusRealm without service overlap)
// Stage 3: Synthesized Personalization Fields for email merge tags

export { FOCUSREALM_CONTEXT } from "./company-context.js";
import { cleanResearchNotes, normalizeFirstName } from "./contact-normalizer.js";
import type { MergeData } from "./merge.js";

export type PartnerDomain =
  | "marketing_agency"
  | "staff_training"
  | "talent_recruitment"
  | "revenue_management"
  | "guest_analytics"
  | "hotel_technology"
  | "operations_consulting"
  | "general_hospitality"
  | "unfamiliar_domain";

export interface CompanyUnderstanding {
  companyName: string;
  domain: PartnerDomain;
  domainLabel: string;
  coreActivity: string; // Natural noun phrase suitable for "work across..."
  primaryOfferings: string;
  targetCustomers: string;
  customerValue: string;
  confidence: "high" | "medium" | "low";
  sourceFieldsUsed: string[];
}

export interface PartnershipReasoning {
  domain: PartnerDomain;
  complementaryAngle: string;
  partnershipProposal: string;
  initiativeHeadline: string;
  partnerStrength: string;
  partnerOutcome: string;
  partnerOffering: string;
  isCautious: boolean;
  rationalSummary: string;
}

export interface RecipientPersonalization {
  understanding: CompanyUnderstanding;
  reasoning: PartnershipReasoning;
  mergeData: MergeData;
}

/**
 * Extracts and cleans text from various custom fields and columns.
 */
function extractCorpus(contact: Record<string, any>): {
  aboutText: string;
  oppText: string;
  fullCorpus: string;
  fieldsUsed: string[];
} {
  const custom =
    contact.customFields && typeof contact.customFields === "object" && !Array.isArray(contact.customFields)
      ? (contact.customFields as Record<string, unknown>)
      : {};

  const fieldsUsed: string[] = [];

  const rawAbout =
    custom.aboutCompany ??
    custom.whatItDoes ??
    custom["What it does"] ??
    custom.servicesProvided ??
    custom.description ??
    custom.overview ??
    "";
  if (rawAbout) fieldsUsed.push("aboutCompany");

  const rawOpp =
    custom.partnershipOpportunity ??
    custom["Partnership opportunity"] ??
    custom.personalizationAngle ??
    custom.partnershipAngle ??
    custom.potentialPartnership ??
    "";
  if (rawOpp) fieldsUsed.push("partnershipOpportunity");

  const aboutClean = cleanResearchNotes(String(rawAbout)).replace(/Focus Realm/g, "FocusRealm");
  const oppClean = cleanResearchNotes(String(rawOpp)).replace(/Focus Realm/g, "FocusRealm");

  const fullCorpus = [
    contact.company ?? "",
    contact.title ?? "",
    contact.hotelSegment ?? "",
    contact.contactPersona ?? "",
    aboutClean,
    oppClean,
    String(custom.industry ?? ""),
    String(custom.category ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  return { aboutText: aboutClean, oppText: oppClean, fullCorpus, fieldsUsed };
}

/**
 * Stage 1: Understand Recipient Company
 * Works dynamically for any company from imported data. Never invents unsupported facts.
 */
export function understandRecipientCompany(contact: {
  company?: string | null;
  title?: string | null;
  hotelSegment?: string | null;
  contactPersona?: string | null;
  customFields?: unknown;
}): CompanyUnderstanding {
  const companyName = contact.company?.trim() || "your company";
  const { aboutText, fullCorpus, fieldsUsed } = extractCorpus(contact);

  // 1. Detect Domain from evidence
  let domain: PartnerDomain = "unfamiliar_domain";
  let domainLabel = "Business Partner";
  let confidence: "high" | "medium" | "low" = "low";

  if (
    /\b(real[\s-]?time\s+insight|sentiment|guest\s+feedback|feedback\s+engine|guest\s+intelligence|reputation\s+management|review\s+analytics|guest\s+sentiment)\b/.test(
      fullCorpus
    )
  ) {
    domain = "guest_analytics";
    domainLabel = "Guest Intelligence & Feedback Analytics";
    confidence = "high";
  } else if (
    /\b(revenue|revenue[\s-]?management|pricing|distribution|yield|channel\s+manager|revpar|adr|rate\s+strategy|revopt)\b/.test(
      fullCorpus
    ) &&
    !/\b(recruitment|creative\s+agency|training\s+program)\b/.test(fullCorpus)
  ) {
    domain = "revenue_management";
    domainLabel = "Revenue Optimization & Distribution";
    confidence = "high";
  } else if (
    /\b(training|lms|learning\s+infrastructure|operational\s+learning|curriculum|hospitality\s+staff\s+training|hti|teaches\s+employees)\b/.test(
      fullCorpus
    )
  ) {
    domain = "staff_training";
    domainLabel = "Hospitality Training & Development";
    confidence = "high";
  } else if (
    /\b(recruitment|job[\s-]?placement|staffing|talent\s+acquisition|hiring|headhunting|manpower|webvi)\b/.test(
      fullCorpus
    )
  ) {
    domain = "talent_recruitment";
    domainLabel = "Hospitality Recruitment & Staffing";
    confidence = "high";
  } else if (
    /\b(marketing|creative\s+agency|pr|events|content|influencer|roadshows|branding|advertising|guest\s+acquisition|direct[\s-]?booking|growguest|concierge)\b/.test(
      fullCorpus
    )
  ) {
    domain = "marketing_agency";
    domainLabel = "Hospitality Marketing & Creative Agency";
    confidence = "high";
  } else if (
    /\b(pms|pos|hotel\s+software|saas|api|integration|guest\s+app|hotel\s+technology)\b/.test(fullCorpus)
  ) {
    domain = "hotel_technology";
    domainLabel = "Hotel Technology Solutions";
    confidence = "high";
  } else if (/\b(consulting|audits|mystery\s+shopping|sop\s+manuals|quality\s+inspection)\b/.test(fullCorpus)) {
    domain = "operations_consulting";
    domainLabel = "Hospitality Operations Consulting";
    confidence = "high";
  } else if (
    /\b(hotel|resort|hospitality|property|residences|lodging)\b/.test(fullCorpus) &&
    !/\b(laundry|linen|amenities|logistics|supplier|supplies|manufacturing|equipment|packaging)\b/.test(fullCorpus)
  ) {
    domain = "general_hospitality";
    domainLabel = "Hospitality Services";
    confidence = aboutText.length > 20 ? "medium" : "low";
  }

  // 2. Extract Core Activity as a natural noun phrase for "work across..."
  let coreActivity = "";

  // Check if aboutText has an explicit list of services (e.g. "working on marketing, PR, events...")
  const listMatch = aboutText.match(
    /\b(?:on|across|in|for)\s+((?:marketing|pr|events|content|influencer|branding|advertising|roadshows|digital\s+marketing|revenue\s+management|distribution|pricing|staff\s+training|recruitment|talent\s+placement|guest\s+feedback|sentiment\s+analytics)(?:,\s*[a-zA-Z\s&]+)*(?:\s*(?:and|&)\s*[a-zA-Z\s]+)?)/i
  );

  if (listMatch && listMatch[1] && listMatch[1].trim().length < 80) {
    const list = listMatch[1].trim();
    coreActivity = list.toLowerCase().includes("hospitality") || list.toLowerCase().includes("hotel")
      ? list
      : `hospitality ${list}`;
  } else {
    // Deduce concise factual description based on domain
    switch (domain) {
      case "guest_analytics":
        coreActivity = "real-time guest feedback and sentiment analytics";
        break;
      case "revenue_management":
        coreActivity = "hotel revenue management, pricing and distribution";
        break;
      case "staff_training":
        coreActivity = "customized hospitality training and staff development";
        break;
      case "talent_recruitment":
        coreActivity = "hospitality talent recruitment and job placement";
        break;
      case "marketing_agency":
        if (/digital\s+marketing.*hotel[\s-]?operations/i.test(aboutText)) {
          coreActivity = "hospitality marketing for independent hotels and resorts, combining digital marketing with hotel-operations experience";
        } else {
          coreActivity = "hospitality marketing, PR, content and guest acquisition";
        }
        break;
      case "hotel_technology":
        coreActivity = "hospitality technology and system integrations";
        break;
      case "operations_consulting":
        coreActivity = "hospitality quality audits and operational consulting";
        break;
      case "general_hospitality":
        coreActivity = "hospitality operations and service excellence";
        break;
      default: {
        const firstClause = aboutText ? aboutText.replace(/^(?:a|an|the)\s+/i, "").split(/[.!?]|(?:,|;)\s*(?:serving|with|including)/i)[0]?.trim().toLowerCase() : "";
        coreActivity = firstClause && firstClause.length <= 70
          ? firstClause
          : "specialized commercial services";
        break;
      }
    }
  }

  // Primary offerings & value
  let primaryOfferings = "Specialized hospitality solutions";
  let targetCustomers = "Hotels, resorts, and hospitality clients";
  let customerValue = "Delivering specialized domain expertise to properties";

  switch (domain) {
    case "guest_analytics":
      primaryOfferings = "Real-time guest sentiment tracking and operational feedback intelligence";
      customerValue = "Surfacing guest experience issues before they become negative online reviews";
      break;
    case "revenue_management":
      primaryOfferings = "Pricing strategy, yield optimization, and multi-channel inventory distribution";
      customerValue = "Maximizing RevPAR, ADR, and commercial profitability for properties";
      break;
    case "staff_training":
      primaryOfferings = "In-person service standards training and operational learning programs";
      customerValue = "Equipping frontline hospitality staff with essential service standards";
      break;
    case "talent_recruitment":
      primaryOfferings = "Hospitality talent search, staff placement, and job-platform matching";
      customerValue = "Supplying vetted hospitality professionals to properties and restaurants";
      break;
    case "marketing_agency":
      primaryOfferings = "Direct booking growth, digital campaigns, PR, and brand storytelling";
      customerValue = "Strengthening hotel visibility and driving qualified direct reservations";
      break;
    case "hotel_technology":
      primaryOfferings = "Hotel management software, integrations, and operational tools";
      customerValue = "Digitizing property operations and administrative workflows";
      break;
    default:
      if (aboutText) {
        primaryOfferings = aboutText.slice(0, 80);
      }
  }

  return {
    companyName,
    domain,
    domainLabel,
    coreActivity,
    primaryOfferings,
    targetCustomers,
    customerValue,
    confidence,
    sourceFieldsUsed: fieldsUsed,
  };
}

/**
 * Stage 2: Partnership Reasoning
 * Computes how recipient's business realistically complements FocusRealm's Mise Hotel platform.
 */
export function reasonPartnershipOpportunity(
  understanding: CompanyUnderstanding,
  contact: Record<string, any>
): PartnershipReasoning {
  const { oppText } = extractCorpus(contact);
  const company = understanding.companyName;

  // 1. Extract any quoted initiative title from research (e.g. "Guest Experience Beyond the Booking", “More Bookings, Better Operations”)
  let initiativeHeadline = "";
  const quoteMatch = oppText.match(/["“]([^"”]+)["”]/);
  if (quoteMatch && quoteMatch[1] && quoteMatch[1].trim().length >= 4) {
    initiativeHeadline = `"${quoteMatch[1].trim()}"`;
  }

  let complementaryAngle = "";
  let partnershipProposal = "";
  let partnerStrength = "specialized hospitality expertise";
  let partnerOutcome = "deliver specialized services to properties";
  let partnerOffering = `a specialized service assessment from ${company}`;
  let isCautious = false;

  switch (understanding.domain) {
    case "guest_analytics":
      partnerStrength = "real-time guest sentiment and feedback intelligence";
      partnerOutcome = "capture real-time guest sentiment and surface feedback gaps";
      partnerOffering = `a guest sentiment audit from ${company}`;
      complementaryAngle =
        `At FocusRealm, our Mise Hotel platform helps properties verify frontline task execution on the floor. While ${company} captures real-time guest sentiment and surfaces feedback gaps, Mise Hotel ensures those insights immediately translate into assigned, verified operational tasks for frontline hotel teams.`;
      partnershipProposal =
        initiativeHeadline ||
        "a pilot combining real-time guest feedback intelligence with verified frontline task resolution for mutual hotel clients";
      break;

    case "revenue_management":
      partnerStrength = "hotel revenue strategy and pricing optimization";
      partnerOutcome = "optimize pricing, distribution and RevPAR";
      partnerOffering = `a commercial revenue assessment from ${company}`;
      complementaryAngle =
        `At FocusRealm, we help hotels strengthen frontline service execution and operational consistency through our Mise Hotel platform. We see a strong opportunity to connect revenue-growth initiatives with operational consistency, helping hotel clients safeguard their guest ratings and commercial performance.`;
      partnershipProposal =
        initiativeHeadline ||
        "a joint hotel-performance assessment covering commercial performance and frontline service consistency for hotel clients";
      break;

    case "staff_training":
      partnerStrength = "hospitality service training and staff development";
      partnerOutcome = "equip frontline teams with essential service standards";
      partnerOffering = `a service standards assessment from ${company}`;
      complementaryAngle =
        `At FocusRealm, our Mise Hotel platform focuses on verified daily service execution. While your programs equip frontline teams with essential service standards, Mise Hotel provides the mobile execution platform to verify daily task execution and accountability across properties.`;
      partnershipProposal =
        initiativeHeadline ||
        "a joint initiative connecting hospitality staff training with verified daily service execution for selected hotel clients";
      break;

    case "talent_recruitment":
      partnerStrength = "hospitality talent recruitment and staffing";
      partnerOutcome = "recruit and place qualified hospitality talent";
      partnerOffering = `a talent placement review from ${company}`;
      complementaryAngle =
        `At FocusRealm, our Mise Hotel platform helps hotel teams execute brand standards consistently. While ${company} helps properties recruit and place great hospitality talent, Mise Hotel provides newly placed teams with clear mobile SOP workflows to ensure consistent service execution from day one.`;
      partnershipProposal =
        initiativeHeadline ||
        "a joint initiative combining hospitality hiring with verified frontline service execution for selected hotel clients";
      break;

    case "marketing_agency":
      partnerStrength = "hotel marketing and direct-booking growth";
      partnerOutcome = "attract guests and increase direct bookings";
      partnerOffering = `a direct-booking audit from ${company}`;
      complementaryAngle =
        `At FocusRealm, we're focused on helping hotels improve frontline service execution and operational consistency. While your work helps hotels strengthen their visibility and guest acquisition, we could potentially help those same properties deliver a more consistent guest experience once guests arrive.`;
      partnershipProposal =
        initiativeHeadline ||
        '"More Bookings, Better Operations", combining a direct-booking audit from ' + company + ' with an operational execution pilot from FocusRealm';
      break;

    case "hotel_technology":
      partnerStrength = "hotel technology solutions and system workflows";
      partnerOutcome = "power core hotel management systems";
      partnerOffering = `a system workflow evaluation from ${company}`;
      complementaryAngle =
        `At FocusRealm, we developed Mise Hotel as a frontline task execution platform. We see an interesting opportunity to explore a potential integration or complementary offering combining your technology solutions with our mobile frontline task execution platform.`;
      partnershipProposal =
        initiativeHeadline ||
        "exploring a complementary pilot or integration for mutual hotel clients";
      break;

    case "operations_consulting":
      partnerStrength = "hospitality quality audits and operational consulting";
      partnerOutcome = "identify operational gaps and audit requirements";
      partnerOffering = `an operational quality audit from ${company}`;
      complementaryAngle =
        `At FocusRealm, our Mise Hotel platform helps properties translate quality standards into daily floor execution. While ${company} identifies operational gaps and audit requirements, Mise Hotel helps hotels track corrective actions and verify daily completion.`;
      partnershipProposal =
        initiativeHeadline ||
        "a collaborative offering pairing audit findings with verified digital task completion for hotel clients";
      break;

    default:
      isCautious = true;
      partnerStrength = "specialized hospitality expertise";
      partnerOutcome = "deliver specialized domain expertise to properties";
      partnerOffering = `a specialized service audit from ${company}`;
      complementaryAngle =
        `At FocusRealm, our Mise Hotel platform is dedicated to helping hospitality teams translate operational standards into verified daily tasks. Given ${company}'s presence in the industry, we see an opportunity to explore whether our frontline execution platform could complement what you deliver to clients without any operational overlap.`;
      partnershipProposal =
        initiativeHeadline ||
        "an introductory discussion to explore potential mutual synergies for hotel clients";
      break;
  }

  return {
    domain: understanding.domain,
    complementaryAngle,
    partnershipProposal,
    initiativeHeadline: initiativeHeadline || (understanding.domain === "marketing_agency" ? '"More Bookings, Better Operations"' : partnershipProposal),
    partnerStrength,
    partnerOutcome,
    partnerOffering,
    isCautious,
    rationalSummary: `${understanding.companyName} (${understanding.domainLabel}) complements FocusRealm via: ${complementaryAngle.slice(0, 100)}...`,
  };
}

/**
 * Stage 3: Synthesize Recipient Personalization
 * Integrates Stage 1 (Understanding) & Stage 2 (Reasoning) into the exact merge fields
 * consumed by the existing email templates.
 */
export function synthesizeRecipientPersonalization(
  contact: {
    email: string;
    firstName?: string | null;
    lastName?: string | null;
    company?: string | null;
    title?: string | null;
    phone?: string | null;
    hotelSegment?: string | null;
    contactPersona?: string | null;
    customFields?: unknown;
  },
  overrides?: MergeData
): RecipientPersonalization {
  const understanding = understandRecipientCompany(contact);
  const reasoning = reasonPartnershipOpportunity(understanding, contact);

  const normFirst = normalizeFirstName(contact.firstName, contact.lastName);
  const fullName = [normFirst, contact.lastName].filter(Boolean).join(" ");
  const custom =
    contact.customFields && typeof contact.customFields === "object" && !Array.isArray(contact.customFields)
      ? (contact.customFields as Record<string, unknown>)
      : {};

  const greetingLine = normFirst ? `Hi ${normFirst},` : `Dear ${understanding.companyName || "Team"} Team,`;

  const mergeData: MergeData = {
    ...custom,
    email: contact.email,
    firstName: normFirst || undefined,
    lastName: contact.lastName?.trim() || undefined,
    fullName: fullName || undefined,
    company: contact.company?.trim() || undefined,
    title: contact.title?.trim() || undefined,
    phone: contact.phone?.trim() || undefined,
    hotelSegment: contact.hotelSegment ?? undefined,
    contactPersona: contact.contactPersona ?? undefined,

    // High-fidelity synthesized fields:
    greetingLine,
    whatItDoes: understanding.coreActivity,
    aboutCompany: understanding.coreActivity,
    servicesProvided: understanding.coreActivity,
    partnerStrength: reasoning.partnerStrength,
    partnerOutcome: reasoning.partnerOutcome,
    partnerOffering: reasoning.partnerOffering,
    initiativeHeadline: reasoning.initiativeHeadline,
    partnerComplement: reasoning.complementaryAngle,
    partnerProposal: reasoning.partnershipProposal,
    partnershipOpportunity: reasoning.partnershipProposal,
    personalizationAngle: reasoning.partnershipProposal,
    partnerFocus: understanding.primaryOfferings,
    partnerDomain: understanding.domain,
    partnerCategory: understanding.domain,
    partnerCategoryLabel: understanding.domainLabel,

    ...(overrides ?? {}),
  };

  return {
    understanding,
    reasoning,
    mergeData,
  };
}
