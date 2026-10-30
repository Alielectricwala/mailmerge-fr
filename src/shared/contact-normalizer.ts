// Contact normalization & partnership research sanitization
// Ensures email copy is clean, natural, and never leaks internal researcher notes or malformed data.

import type { MergeData } from "./merge.js";

export type PartnerCategory =
  | "marketing"
  | "recruitment"
  | "training"
  | "revenue"
  | "technology"
  | "general";

export interface CategoryValueProposition {
  category: PartnerCategory;
  categoryLabel: string;
  focusArea: string;
  whatTheyDo: string;
  complementaryAngle: string;
  initiativeProposal: string;
}

const GENERIC_NAME_PATTERNS = [
  /^(founder|co-?founder|ceo|cto|cfo|coo|director|partner|head|manager|team|contact|info|sales|hello|support|guest|customer|user|there|admin|unknown|n\/a|na|marketing|operations|hospitality|consultant|advisor|lead|owner)$/i,
  /^contact\s+team$/i,
  /^\/\s*contact\s*team$/i,
];

/**
 * Normalizes contact first name.
 * If the imported first name is generic ("Founder", "Admin", "/ Contact team", etc.)
 * or a job title, returns undefined so templates fall back cleanly to "there" (e.g. "Hi there,").
 */
export function normalizeFirstName(rawFirst?: string | null, rawLast?: string | null): string | undefined {
  if (!rawFirst) return undefined;

  let cleaned = rawFirst.trim();

  // Strip trailing notes or titles like "/ Contact team", "(CEO)", "& Director"
  cleaned = cleaned.replace(/\s*\/.*$/, "").replace(/\s*\(.*?\)/, "").replace(/\s*&.*$/, "").trim();

  if (!cleaned || cleaned.length < 2) return undefined;

  // Check against generic role / placeholder words
  for (const pattern of GENERIC_NAME_PATTERNS) {
    if (pattern.test(cleaned)) return undefined;
  }

  // If the last name also contains generic words like "/ Contact team", ensure we don't treat first name as a name if it's "Founder"
  if (rawLast && /contact\s*team|unknown|n\/a/i.test(rawLast) && /founder|ceo|owner|director/i.test(cleaned)) {
    return undefined;
  }

  // Proper title casing
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
}

/**
 * Strips researcher evaluation instructions and internal qualification notes.
 * Internal validation notes like "Validate active hotel-account count", "Request property count before prioritizing",
 * "willingness to make direct introductions", etc. MUST NEVER be sent to recipients.
 */
export function cleanResearchNotes(raw?: string | null): string {
  if (!raw) return "";

  let text = String(raw).trim();
  if (!text) return "";

  // Always fix "Focus Realm" to "FocusRealm"
  text = text.replace(/Focus Realm/g, "FocusRealm");

  // 1. Remove bracketed internal notes like [validate...] or (validate...)
  text = text.replace(/\[\s*(?:validate|check|verify|request|confirm|assess)[\s\S]*?\]/gi, "");

  // 2. Remove sentences or clauses containing internal evaluation directives:
  // e.g. "Validate active hotel-account count and willingness to make direct introductions."
  // e.g. "Request the current managed-property count before prioritizing the partnership."
  // e.g. "Founder-led structure should support a fast partnership test; validate active client count."
  text = text.replace(/(?:;\s*)?(?:validate|request|confirm|check|verify|assess|prioritize)\s+(?:active\s+)?(?:client|hotel-account|account|managed-property|property|lead|hotel)[\s\S]*?(?:[.!?]|$)/gi, "");
  text = text.replace(/request\s+the\s+current\s+[\s\S]*?(?:before\s+prioritizing[\s\S]*?)?(?:[.!?]|$)/gi, "");
  text = text.replace(/willingness\s+to\s+make\s+direct\s+introductions[.!?]?/gi, "");
  text = text.replace(/founder-led\s+structure\s+should\s+support\s+a\s+fast\s+partnership\s+test[.!?]?/gi, "");

  // 3. Clean informal shorthand research notes into natural prose:
  // e.g. "HTI teaches employees how to perform (LMS) we Verify Service execution (LTS)"
  if (/teaches\s+employees.*(?:lms|lts)/i.test(text)) {
    text = 'connecting hospitality staff training with verified daily service execution';
  } else if (/recruitment\s+agency\s+we\s+help\s+maintain\s+the\s+quality/i.test(text)) {
    text = 'combining hospitality recruitment with consistent frontline service execution';
  }

  // Clean trailing punctuation, semicolons, extra spaces
  text = text
    .replace(/[;\s]+$/, "")
    .replace(/^\s*[;:-]\s*/, "")
    .replace(/\s{2,}/g, " ")
    .trim();

  // If empty after stripping notes, return empty
  if (text.length < 5) return "";

  return text;
}

/**
 * Normalizes company overview descriptions:
 * Strips raw promotional noise or research markers, keeping concise prose.
 */
export function cleanAboutCompany(raw?: string | null): string {
  if (!raw) return "";
  let text = String(raw).trim();
  if (!text) return "";

  // Strip researcher prefixes like "Webvi describes itself as..." or "HTI provides..."
  text = text.replace(/^(?:a\s+)?(?:delhi|mumbai|bengaluru|bangalore|goa|india)-based\s+/i, "");
  text = text.replace(/^(?:the\s+company|this\s+company|they|it)\s+(?:is|provides|focuses\s+on)\s+/i, "");

  // Keep first clean sentence or up to 120 chars
  const firstSentence = text.split(/(?<=[.!?])\s+/)[0] ?? text;
  return firstSentence.trim();
}

/**
 * Detects the partner's category and returns the tailored value proposition.
 * Ensures marketing agencies NEVER receive "revenue-growth initiatives" and
 * revenue consultants NEVER receive "creative/marketing" copy.
 */
export function detectPartnerCategory(contact: {
  company?: string | null;
  title?: string | null;
  hotelSegment?: string | null;
  contactPersona?: string | null;
  customFields?: unknown;
}): CategoryValueProposition {
  const custom =
    contact.customFields && typeof contact.customFields === "object" && !Array.isArray(contact.customFields)
      ? (contact.customFields as Record<string, unknown>)
      : {};

  const fullCorpus = [
    contact.company ?? "",
    contact.title ?? "",
    String(custom.aboutCompany ?? ""),
    String(custom.whatItDoes ?? ""),
    String(custom.servicesProvided ?? ""),
    String(custom.partnershipOpportunity ?? ""),
    String(custom.personalizationAngle ?? ""),
    String(custom.industry ?? ""),
  ].join(" ").toLowerCase();

  // 1. Marketing / Creative / PR / Media Agency
  if (
    /\b(marketing|creative|pr|events|content|influencer|roadshows|media|branding|advertising|guest acquisition|direct-booking|growguest|concierge)\b/.test(
      fullCorpus
    ) &&
    !/\b(revenue-management|pricing|distribution)\b/.test(fullCorpus)
  ) {
    return {
      category: "marketing",
      categoryLabel: "Marketing & Creative Agency",
      focusArea: "guest acquisition and brand visibility",
      whatTheyDo: "hospitality marketing, PR, and guest acquisition",
      complementaryAngle:
        "While your work helps hotels strengthen their visibility and guest acquisition, FocusRealm helps those same properties deliver a more consistent guest experience once guests arrive.",
      initiativeProposal:
        'a joint initiative around "Guest Experience Beyond the Booking", combining hospitality marketing with operational readiness for selected hotel clients',
    };
  }

  // 2. Recruitment / Staffing Platform
  if (/\b(recruitment|job-placement|staffing|talent|hiring|headhunting|placement|manpower|recruiting|webvi)\b/.test(fullCorpus)) {
    return {
      category: "recruitment",
      categoryLabel: "Recruitment & Placement",
      focusArea: "hospitality hiring and placement",
      whatTheyDo: "hospitality talent recruitment and job placement",
      complementaryAngle:
        "While your platform helps properties recruit and place great hospitality talent, FocusRealm ensures those teams maintain consistent frontline service execution on the floor.",
      initiativeProposal:
        "a joint initiative combining hospitality hiring with verified frontline service execution for selected hotel clients",
    };
  }

  // 3. Training / LMS Company
  if (/\b(training|lms|learning|curriculum|hospitality staff|teaches employees|operational learning|workforce training|academy|hti)\b/.test(fullCorpus)) {
    return {
      category: "training",
      categoryLabel: "Hospitality Training",
      focusArea: "staff training and service standards",
      whatTheyDo: "customized hospitality training and operational learning",
      complementaryAngle:
        "While your programs equip frontline teams with essential service training, FocusRealm provides the operational execution platform to verify daily task execution across properties.",
      initiativeProposal:
        "a joint initiative connecting staff training with verified daily service execution for selected hotel clients",
    };
  }

  // 4. Revenue Management / Pricing / Distribution
  if (/\b(revenue|revenue-management|pricing|distribution|yield|channel manager|commercial performance|roomnights)\b/.test(fullCorpus)) {
    return {
      category: "revenue",
      categoryLabel: "Revenue Management & Distribution",
      focusArea: "commercial performance and pricing",
      whatTheyDo: "hotel revenue management, pricing and distribution",
      complementaryAngle:
        "We believe there may be an opportunity to combine revenue-growth initiatives with operational improvements, helping selected properties focus on both commercial performance and the guest experience.",
      initiativeProposal:
        "a joint hotel-performance assessment covering both commercial performance and frontline service consistency",
    };
  }

  // 5. Technology Provider / Software / PMS
  if (/\b(software|platform|technology|tech provider|integration|pms|pos|saas|api|systems)\b/.test(fullCorpus)) {
    return {
      category: "technology",
      categoryLabel: "Hotel Technology",
      focusArea: "hotel technology and systems",
      whatTheyDo: "hospitality technology solutions",
      complementaryAngle:
        "We see an opportunity to explore a potential integration or complementary offering combining your technology with FocusRealm's frontline operational platform.",
      initiativeProposal:
        "exploring a complementary pilot or integration for mutual hotel clients",
    };
  }

  // 6. Default / General Hospitality Partner
  return {
    category: "general",
    categoryLabel: "Hospitality Partner",
    focusArea: "hospitality operations",
    whatTheyDo: "hospitality operations and service excellence",
    complementaryAngle:
      "While your team focuses on your core hospitality services, FocusRealm complements this by ensuring frontline service execution and operational readiness across properties.",
    initiativeProposal:
      "exploring a complementary referral or pilot initiative for mutual hotel clients",
  };
}

/**
 * Summarizes raw company description into a concise, email-ready "work across..." phrase.
 * Never dumps raw multiline descriptions or promotional paragraphs into sentences.
 */
export function summarizeWorkAcross(raw?: string | null, category?: PartnerCategory): string {
  const cat = category ?? "general";
  const defaultByCat: Record<PartnerCategory, string> = {
    marketing: "hospitality marketing, PR, content and events",
    recruitment: "hospitality talent recruitment and job placement",
    training: "customized hospitality training and staff development",
    revenue: "hotel revenue management, pricing and distribution",
    technology: "hospitality technology solutions",
    general: "hospitality services",
  };

  if (!raw) return defaultByCat[cat];

  let text = String(raw).trim().replace(/Focus Realm/g, "FocusRealm");
  if (!text) return defaultByCat[cat];

  // 1. Check for lists of services in the text like "on marketing, PR, events, content..."
  const listMatch = text.match(/\b(?:on|across|in|for)\s+((?:marketing|pr|events|content|influencer|branding|advertising|roadshows|digital marketing)(?:,\s*(?:pr|events|content|influencer|branding|advertising|roadshows|digital marketing))*(?:\s*(?:and|&)\s*(?:events|content|influencer|branding|advertising|roadshows|digital marketing))?)/i);
  if (listMatch && listMatch[1]) {
    const list = listMatch[1].trim();
    return list.toLowerCase().includes("hospitality") ? list : `hospitality ${list}`;
  }

  // 2. If it is already a short, clean phrase (< 60 chars) without punctuation or complete sentences
  if (text.length <= 60 && !/[.!?]/.test(text) && !/^(a|the|it|they|this|we|our)\s+/i.test(text)) {
    return text;
  }

  // 3. Fallback to category-tailored concise phrase
  return defaultByCat[cat];
}

/**
 * Summarizes raw partnership / personalization angle into a concise, email-ready initiative phrase.
 * Strips validation directives, researcher notes, and extracts quoted initiative names or clean phrases.
 */
export function summarizePartnershipOpportunity(raw?: string | null, category?: PartnerCategory): string {
  const cat = category ?? "general";
  const defaultByCat: Record<PartnerCategory, string> = {
    marketing: '"Guest Experience Beyond the Booking"',
    recruitment: "combining hospitality recruitment with consistent frontline service execution",
    training: "connecting hospitality staff training with verified daily service execution",
    revenue: "a joint hotel-performance assessment covering commercial performance and frontline service consistency",
    technology: "exploring a complementary pilot or integration for mutual hotel clients",
    general: "exploring a complementary referral or pilot initiative",
  };

  if (!raw) return defaultByCat[cat];

  let text = cleanResearchNotes(raw);
  if (!text) return defaultByCat[cat];

  text = text.replace(/Focus Realm/g, "FocusRealm");

  // 1. If text contains a quoted initiative name like "Guest Experience Beyond the Booking" or “More Bookings, Better Operations”
  const quoteMatch = text.match(/["“]([^"”]+)["”]/);
  if (quoteMatch && quoteMatch[1] && quoteMatch[1].trim().length >= 4) {
    return `"${quoteMatch[1].trim()}"`;
  }

  // 2. If text contains a joint hotel-performance assessment phrase
  if (/joint\s+hotel-performance\s+assessment/i.test(text)) {
    return "a joint hotel-performance assessment covering commercial performance and frontline service consistency";
  }

  // 3. If text is short and concise without internal directives
  if (text.length <= 80 && !/(?:validate|request|prioritize|confirm|check|verify|lms|lts)/i.test(text)) {
    if (!text.startsWith('"') && !text.startsWith('“')) {
      return text.charAt(0).toLowerCase() + text.slice(1);
    }
    return text;
  }

  return defaultByCat[cat];
}

/**
 * Normalizes all contact fields into a clean MergeData dictionary.
 * Guarantees that internal research notes are stripped, first names are human names,
 * and category-specific value propositions are readily available.
 */
export function normalizeContactMergeData(
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
): MergeData {
  const normFirst = normalizeFirstName(contact.firstName, contact.lastName);
  const fullName = [normFirst, contact.lastName].filter(Boolean).join(" ");
  const custom =
    contact.customFields && typeof contact.customFields === "object" && !Array.isArray(contact.customFields)
      ? (contact.customFields as Record<string, unknown>)
      : {};

  const valueProp = detectPartnerCategory(contact);

  const rawAbout = String(custom.aboutCompany ?? custom.whatItDoes ?? custom.servicesProvided ?? "").trim();
  const rawOpp = String(custom.partnershipOpportunity ?? custom.personalizationAngle ?? custom.potentialPartnership ?? "").trim();

  const effectiveWhatTheyDo = summarizeWorkAcross(rawAbout, valueProp.category);
  const effectiveInitiative = summarizePartnershipOpportunity(rawOpp, valueProp.category);

  return {
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

    // Polished, research-free fields for email templates:
    aboutCompany: effectiveWhatTheyDo,
    whatItDoes: effectiveWhatTheyDo,
    servicesProvided: effectiveWhatTheyDo,
    partnershipOpportunity: effectiveInitiative,
    personalizationAngle: effectiveInitiative,

    // Category-specific value props:
    partnerCategory: valueProp.category,
    partnerFocus: valueProp.focusArea,
    partnerComplement: valueProp.complementaryAngle,
    partnerProposal: effectiveInitiative,

    ...(overrides ?? {}),
  };
}
