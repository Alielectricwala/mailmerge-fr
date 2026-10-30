// Hotel segmentation and contact persona classification.
// Pure, deterministic taxonomy matching and heuristic inference.
//
// Critical rule: Guessed values are explicitly identified and never treated as verified facts.
import {
  CONTACT_PERSONAS,
  HOTEL_SEGMENTS,
  type ContactPersona,
  type EnrichmentStatus,
  type HotelSegment,
} from "../../shared/types.js";

const SEGMENT_SYNONYMS: Record<HotelSegment, string[]> = {
  LUXURY: ["luxury", "5 star", "5-star", "fivestar", "ultra luxury", "palace", "grand hotel"],
  BOUTIQUE: ["boutique", "lifestyle", "design hotel", "historic", "heritage", "maison", "chateau", "villa"],
  UPSCALE: ["upscale", "full service", "4 star", "4-star", "fourstar", "upper upscale", "premium"],
  MIDSCALE: ["midscale", "select service", "limited service", "3 star", "3-star", "threestar"],
  BUDGET: ["budget", "economy", "motel", "hostel", "inn", "lodge", "1 star", "2 star", "roadside"],
  RESORT: ["resort", "destination", "spa resort", "beach resort", "golf resort", "ski resort", "retreat"],
  EXTENDED_STAY: ["extended stay", "aparthotel", "residence", "serviced apartments", "suites", "kitchenette"],
  INDEPENDENT: ["independent", "unbranded", "private hotel", "owner operated", "single property", "hotel", "hotels", "htl", "hospitality"],
  CO_PARTNERSHIP: [
    "co-partnership",
    "co partnership",
    "partnership",
    "partner",
    "co-marketing",
    "co marketing",
    "brand partner",
    "strategic alliance",
    "vendor",
    "software partner",
    "tech partner",
    "concierge",
    "collective",
    "concierge collective",
    "lifestyle management",
    "agency",
    "consultancy",
    "services partner",
  ],
  INSTITUTE: ["institute", "college", "university", "academy", "ihm", "campus", "hiring", "school", "hospitality institute", "management institute"],
  UNKNOWN: ["unknown", "unclassified", "other", "n/a", "none"],
};

const PERSONA_SYNONYMS: Record<ContactPersona, string[]> = {
  GENERAL_MANAGER: ["general manager", "gm", "managing director", "hotel manager", "resident manager", "area gm"],
  OPERATIONS_DIRECTOR: [
    "director of operations",
    "operations director",
    "vp operations",
    "operations manager",
    "front office manager",
    "rooms division manager",
    "agm",
    "assistant general manager",
  ],
  REVENUE_MANAGER: [
    "revenue manager",
    "director of revenue",
    "director of revenue management",
    "dorms",
    "yield manager",
    "pricing manager",
    "vp revenue",
  ],
  SALES_MARKETING_DIRECTOR: [
    "director of sales",
    "director of marketing",
    "sales and marketing",
    "dosm",
    "commercial director",
    "business development",
    "sales manager",
  ],
  IT_DIRECTOR: [
    "it director",
    "director of it",
    "systems manager",
    "chief technology officer",
    "cto",
    "technology manager",
    "head of it",
    "hotel tech",
  ],
  OWNER_OPERATOR: [
    "owner",
    "co-owner",
    "principal",
    "proprietor",
    "founder",
    "asset manager",
    "partner",
    "managing partner",
    "hotel owner",
  ],
  FINANCE_PROCUREMENT: [
    "director of finance",
    "finance director",
    "financial controller",
    "controller",
    "procurement manager",
    "purchasing director",
    "chief financial officer",
    "cfo",
  ],
  PARTNERSHIP_DIRECTOR: [
    "strategic partnerships",
    "strategic partnership",
    "director of strategic partnerships",
    "partnership director",
    "director of partnerships",
    "head of partnerships",
    "head of brand alliances",
    "brand partnerships",
    "brand alliances",
    "alliance manager",
    "alliances director",
    "vp alliances",
    "co marketing manager",
    "partner lead",
  ],
  PLACEMENT_OFFICER: [
    "placement officer",
    "training and placement officer",
    "tpo",
    "head placement",
    "placement manager",
    "campus recruiter",
    "campus relations",
    "internship coordinator",
    "head of training",
    "head of training and placement",
  ],
  DEAN_DIRECTOR: [
    "dean",
    "academic director",
    "principal",
    "institute director",
    "head of institute",
    "chancellor",
    "provost",
    "director academics",
  ],
  OTHER: ["consultant", "coordinator", "supervisor", "specialist", "assistant", "staff"],
  UNKNOWN: ["unknown", "unclassified", "n/a", "none"],
};

function normalizeText(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, " ");
}

function matchesSynonym(cleaned: string, syn: string): boolean {
  if (cleaned === syn) return true;
  const escaped = syn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(`(?:^|\\s)${escaped}(?:\\s|$)`, "i");
  return regex.test(cleaned);
}

/** Normalize arbitrary text to a standard HotelSegment enum value */
export function normalizeHotelSegment(raw?: string | null): HotelSegment {
  if (!raw) return "UNKNOWN";
  const cleaned = normalizeText(raw);
  if (!cleaned) return "UNKNOWN";

  // Check direct exact match with enum key
  const upper = raw.toUpperCase().trim() as HotelSegment;
  if (HOTEL_SEGMENTS.includes(upper)) return upper;

  for (const [segment, synonyms] of Object.entries(SEGMENT_SYNONYMS) as [HotelSegment, string[]][]) {
    for (const syn of synonyms) {
      if (matchesSynonym(cleaned, syn)) {
        return segment;
      }
    }
  }
  return "UNKNOWN";
}

/** Normalize arbitrary text to a standard ContactPersona enum value */
export function normalizeContactPersona(raw?: string | null): ContactPersona {
  if (!raw) return "UNKNOWN";
  const cleaned = normalizeText(raw);
  if (!cleaned) return "UNKNOWN";

  // Check direct exact match with enum key
  const upper = raw.toUpperCase().trim() as ContactPersona;
  if (CONTACT_PERSONAS.includes(upper)) return upper;

  for (const [persona, synonyms] of Object.entries(PERSONA_SYNONYMS) as [ContactPersona, string[]][]) {
    for (const syn of synonyms) {
      if (matchesSynonym(cleaned, syn)) {
        return persona;
      }
    }
  }
  return "UNKNOWN";
}

export interface ClassificationResult<T> {
  value: T;
  confidence: number;
  status: EnrichmentStatus;
  source: string;
}

/** Infer contact persona from their job title heuristically */
export function inferPersonaFromTitle(title?: string | null): ClassificationResult<ContactPersona> {
  if (!title || !title.trim()) {
    return { value: "UNKNOWN", confidence: 0, status: "GUESSED", source: "unspecified_title" };
  }
  const cleaned = normalizeText(title);

  // Check word boundaries / prefixes / acronyms
  if (/\bgm\b/.test(cleaned) || /\bgeneral manager\b/.test(cleaned) || /\bhotel manager\b/.test(cleaned)) {
    return { value: "GENERAL_MANAGER", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(revenue|yield|pricing)\b/.test(cleaned)) {
    return { value: "REVENUE_MANAGER", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(sales|marketing|dosm|commercial)\b/.test(cleaned)) {
    return { value: "SALES_MARKETING_DIRECTOR", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(operations|rooms|front office|agm)\b/.test(cleaned)) {
    return { value: "OPERATIONS_DIRECTOR", confidence: 0.8, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(it|systems|technology|cto|software|tech)\b/.test(cleaned)) {
    return { value: "IT_DIRECTOR", confidence: 0.8, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(owner|proprietor|founder|principal|asset manager)\b/.test(cleaned)) {
    return { value: "OWNER_OPERATOR", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(finance|financial|controller|procurement|purchasing|cfo)\b/.test(cleaned)) {
    return { value: "FINANCE_PROCUREMENT", confidence: 0.8, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(placement|training and placement|tpo|campus recruiter|recruitment|internship|career services|placement officer)\b/.test(cleaned)) {
    return { value: "PLACEMENT_OFFICER", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(dean|principal|provost|chancellor|director academics|professor|head of institute)\b/.test(cleaned)) {
    return { value: "DEAN_DIRECTOR", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }
  if (/\b(partnership|alliances|strategic alliance|co-marketing|channel manager|partner lead)\b/.test(cleaned)) {
    return { value: "PARTNERSHIP_DIRECTOR", confidence: 0.85, status: "GUESSED", source: "title_heuristic" };
  }

  const normalized = normalizeContactPersona(title);
  if (normalized !== "UNKNOWN") {
    return { value: normalized, confidence: 0.7, status: "GUESSED", source: "title_heuristic" };
  }
  return { value: "UNKNOWN", confidence: 0.2, status: "GUESSED", source: "unrecognized_title" };
}

/** Infer hotel segment or organization category from property name, custom fields, or email */
export function inferSegmentFromCompany(
  company?: string | null,
  customFields: Record<string, string> = {},
  email?: string | null
): ClassificationResult<HotelSegment> {
  const emailDomain = email && email.includes("@") ? email.split("@")[1]?.toLowerCase().replace(/\.[a-z.]+$/, "") : "";
  let domainHint = "";
  if (emailDomain) {
    if (/hotels?|resorts?|hospitality/i.test(emailDomain)) domainHint += " hotel";
    if (/concierge|collective|partners?|alliances?|agenc(y|ies)|solutions/i.test(emailDomain)) domainHint += " partner concierge";
    if (/ihm|univ|colleges?|institutes?|academ(y|ies)/i.test(emailDomain)) domainHint += " institute";
  }
  const hints = [
    company,
    domainHint,
    emailDomain,
    customFields.propertyType,
    customFields.segment,
    customFields.stars,
    customFields.category,
    customFields.industry,
    customFields.type,
  ]
    .filter(Boolean)
    .join(" ");

  if (!hints.trim()) {
    return { value: "UNKNOWN", confidence: 0, status: "GUESSED", source: "unspecified_property" };
  }
  const cleaned = normalizeText(hints);

  // 1. Check educational institutions / hiring target first
  if (
    /\b(institutes?|colleges?|universit(y|ies)|ihm|academ(y|ies)|campus|polytechnics?|vidyapeeth|school of hospitality|hospitality institute|placement cell|training institute)\b/.test(
      cleaned
    ) ||
    (email && /\.(edu|ac\.in|edu\.in)(\/|$)/i.test(email)) ||
    (email && /ihm/i.test(email))
  ) {
    return { value: "INSTITUTE", confidence: 0.85, status: "GUESSED", source: "institute_name_heuristic" };
  }

  // 2. Check co-partnerships, agencies, alliances, concierge, collective, solutions
  if (
    /\b(concierge|collective|partners?|partnerships?|alliances?|co\s*marketing|co\s*partnerships?|vendors?|software|solutions|travel\s*tech|consulting|consultanc(y|ies)|agenc(y|ies)|media|platforms?|apps?|systems|lifestyle|membership|promotions?|syndicate|associat(es?|ion))\b/.test(
      cleaned
    )
  ) {
    return { value: "CO_PARTNERSHIP", confidence: 0.85, status: "GUESSED", source: "partnership_heuristic" };
  }

  // 3. Specific hotel property segments
  if (/\b(resort|beach|spa|golf|ski|retreat|island)\b/.test(cleaned)) {
    return { value: "RESORT", confidence: 0.8, status: "GUESSED", source: "property_name_heuristic" };
  }
  if (/\b(extended stay|suites|aparthotel|residence|serviced)\b/.test(cleaned)) {
    return { value: "EXTENDED_STAY", confidence: 0.75, status: "GUESSED", source: "property_name_heuristic" };
  }
  if (/\b(boutique|design|lifestyle hotel|historic|heritage|maison|chateau|haveli)\b/.test(cleaned)) {
    return { value: "BOUTIQUE", confidence: 0.75, status: "GUESSED", source: "property_name_heuristic" };
  }
  if (/\b(luxury|5 star|five star|palace|st regis|ritz|four seasons|taj|oberoi|leela)\b/.test(cleaned)) {
    return { value: "LUXURY", confidence: 0.85, status: "GUESSED", source: "property_name_heuristic" };
  }
  if (/\b(motel|hostel|inn|inns|lodge|budget|economy|1 star|2 star|homestay|guest house)\b/.test(cleaned)) {
    return { value: "BUDGET", confidence: 0.7, status: "GUESSED", source: "property_name_heuristic" };
  }
  if (/\b(upscale|hilton|marriott|sheraton|hyatt|westin|radisson|novotel|crowne plaza)\b/.test(cleaned)) {
    return { value: "UPSCALE", confidence: 0.7, status: "GUESSED", source: "property_name_heuristic" };
  }
  if (/\b(midscale|hampton|holiday inn|courtyard|ibis|best western|ginger|lemon tree)\b/.test(cleaned)) {
    return { value: "MIDSCALE", confidence: 0.7, status: "GUESSED", source: "property_name_heuristic" };
  }

  // 4. General hotel keywords (e.g. "MMR Hotels", "The Grand Hotel", "@mmrhotels.com", "concierge Htl")
  if (/\b(hotels?|htl|hospitality|stays?|villas?)\b/.test(cleaned)) {
    return { value: "INDEPENDENT", confidence: 0.8, status: "GUESSED", source: "hotel_keyword_heuristic" };
  }

  const normalized = normalizeHotelSegment(hints);
  if (normalized !== "UNKNOWN") {
    return { value: normalized, confidence: 0.6, status: "GUESSED", source: "property_name_heuristic" };
  }
  return { value: "UNKNOWN", confidence: 0.2, status: "GUESSED", source: "unrecognized_property" };
}

export function detectProspectListType(
  headers: string[],
  sampleRows: (string[] | Record<string, unknown>)[] = []
): import("../../shared/types.js").ProspectListType {
  const allHeadersText = headers.join(" ").toLowerCase();
  const sampleCellsText = sampleRows
    .flatMap((r) => (Array.isArray(r) ? r.slice(0, 8) : Object.values(r).slice(0, 8)))
    .filter(Boolean)
    .map(String)
    .join(" ")
    .toLowerCase();
  const combined = `${allHeadersText} ${sampleCellsText}`;

  // Co-marketing partner keywords
  const partnerKeywords = [
    "partner",
    "partnership",
    "training provider",
    "recruitment",
    "placement",
    "consultan",
    "services provided",
    "what it does",
    "partnership opportunity",
    "target customers",
    "personalization angle",
    "channel",
  ];
  let partnerScore = 0;
  for (const kw of partnerKeywords) {
    if (combined.includes(kw)) partnerScore += 1;
    if (allHeadersText.includes(kw)) partnerScore += 2;
  }

  // Hotel keywords
  const hotelKeywords = [
    "hotel",
    "resort",
    "palace",
    "boutique",
    "rooms",
    "suites",
    "amenities",
    "facilities",
    "star rating",
    "property type",
    "general manager",
    "operations director",
    "hotelsegment",
    "contactpersona",
    "hospitality",
  ];
  let hotelScore = 0;
  for (const kw of hotelKeywords) {
    if (combined.includes(kw)) hotelScore += 1;
    if (allHeadersText.includes(kw)) hotelScore += 2;
  }

  if (partnerScore > hotelScore && partnerScore >= 2) {
    return "CO_MARKETING_PARTNERS";
  }
  if (hotelScore >= 2 || /hotel|resort|hospitality/i.test(allHeadersText)) {
    return "HOTEL_PROSPECTS";
  }
  return "GENERAL_BUSINESS";
}

export function computeImportQuality(
  headers: string[],
  mapping: Record<string, string>,
  listType: import("../../shared/types.js").ProspectListType = "HOTEL_PROSPECTS"
): import("../../shared/types.js").ImportQualityBreakdown {
  const mappedTargets = new Set(Object.values(mapping));
  const hasEmail = mappedTargets.has("email");
  const hasName = mappedTargets.has("fullName") || mappedTargets.has("firstName");
  const hasCompany = mappedTargets.has("company");
  const hasTargeting =
    mappedTargets.has("hotelSegment") ||
    mappedTargets.has("contactPersona") ||
    mappedTargets.has("title") ||
    Object.keys(mapping).some((k) => /partnership|training|segment|role/i.test(k));

  const essentialMissing: string[] = [];
  if (!hasEmail) essentialMissing.push("Contact Email");
  if (!hasCompany) essentialMissing.push(listType === "HOTEL_PROSPECTS" ? "Hotel Name" : "Company Name");

  const recommendedMissing: string[] = [];
  if (!hasName) recommendedMissing.push("Contact Person");
  if (!mappedTargets.has("title")) recommendedMissing.push("Job Title");
  if (listType === "HOTEL_PROSPECTS" && !mappedTargets.has("hotelSegment")) {
    recommendedMissing.push("Hotel Segment");
  }

  let score = 0;
  if (hasEmail) score += 40;
  if (hasName) score += 20;
  if (hasCompany) score += 20;
  if (hasTargeting) score += 20;

  const personalizationTagsReady: string[] = [];
  if (hasEmail) personalizationTagsReady.push("email");
  if (hasCompany) personalizationTagsReady.push("company");
  if (hasName) personalizationTagsReady.push("firstName");
  if (mappedTargets.has("title")) personalizationTagsReady.push("title");
  if (Object.keys(mapping).some((h) => h.toLowerCase().replace(/[^a-z]/g, "") === "city")) {
    personalizationTagsReady.push("city");
  }
  if (mappedTargets.has("hotelSegment")) personalizationTagsReady.push("hotelSegment");
  if (mappedTargets.has("contactPersona")) personalizationTagsReady.push("contactPersona");

  return {
    score,
    hasEmail,
    hasName,
    hasCompany,
    hasTargeting,
    essentialMissing,
    recommendedMissing,
    personalizationTagsReady,
  };
}
