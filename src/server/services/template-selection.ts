// Deterministic template selection engine for campaigns with multiple email templates.
//
// Evaluates manual overrides, priority-ordered rules (hotel segment, contact persona,
// verified status, minimum confidence, city), and fallback templates.
//
// Critical rules:
// - Never send emails from this selection service.
// - Pure, deterministic, auditable decisions with human-readable explanations.
// - Do not treat unverified/guessed attributes as verified facts.
import type { EnrichmentStatus } from "../../shared/types.js";
import {
  inferPersonaFromTitle,
  inferSegmentFromCompany,
  normalizeContactPersona,
  normalizeHotelSegment,
} from "./classification.js";

export function detectTemplateVertical(
  template: Pick<EligibleTemplate, "name" | "subject">
): "INSTITUTE" | "CO_PARTNERSHIP" | "HOTEL" | "GENERAL" {
  const text = `${template.name} ${template.subject || ""}`.toLowerCase();
  if (/\b(hiring|placement|campus|recruitment|internship|interns|students?|ihm|colleges?|institutes?)\b/i.test(text)) {
    return "INSTITUTE";
  }
  if (/\b(partners?|partnerships?|co\s*market(ing)?|alliances?|collaborat(e|ion|ive)|brand partner|affiliate)\b/i.test(text)) {
    return "CO_PARTNERSHIP";
  }
  if (/\b(hotels?|resorts?|properties|hospitality|gm|general manager|guest|rooms?|revpar|stay)\b/i.test(text)) {
    return "HOTEL";
  }
  return "GENERAL";
}

export interface RecipientProfile {
  id: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  title?: string | null;
  hotelSegment?: string | null;
  hotelSegmentConfidence?: number | null;
  hotelSegmentStatus?: EnrichmentStatus | null;
  contactPersona?: string | null;
  contactPersonaConfidence?: number | null;
  contactPersonaStatus?: EnrichmentStatus | null;
  customFields?: Record<string, string>;
}

export interface EligibleTemplate {
  id: string;
  name: string;
  subject: string;
  bodyHtml: string;
  bodyText?: string | null;
  version: number;
  isFallback?: boolean;
}

export interface SelectionRule {
  id: string;
  templateId: string;
  priority: number;
  hotelSegment?: string | null;
  contactPersona?: string | null;
  requiresVerified?: boolean;
  minConfidence?: number | null;
  city?: string | null;
  description?: string | null;
}

export interface RecipientOverride {
  contactId: string;
  templateId: string;
  reason?: string | null;
}

export interface TemplateSelectionResult {
  templateId: string;
  templateName: string;
  template: EligibleTemplate;
  assignmentSource: "OVERRIDE" | "RULE" | "FALLBACK";
  ruleId: string | null;
  rulePriority: number | null;
  explanation: string;
}

export interface SelectionContext {
  templates: EligibleTemplate[];
  rules: SelectionRule[];
  overrides?: Map<string, RecipientOverride> | Record<string, RecipientOverride>;
  defaultTemplateId: string;
}

function isVerifiedStatus(status?: EnrichmentStatus | null): boolean {
  return status === "VERIFIED" || status === "MANUAL";
}

/**
 * Select the appropriate template for a recipient deterministically.
 * Does not send emails or modify the database.
 */
export function selectTemplateForRecipient(
  recipient: RecipientProfile,
  context: SelectionContext
): TemplateSelectionResult {
  const { templates, rules, overrides, defaultTemplateId } = context;

  if (!templates.length) {
    throw new Error("Cannot select template: no eligible templates provided for this campaign.");
  }

  const templateMap = new Map<string, EligibleTemplate>(templates.map((t) => [t.id, t]));
  const fallbackTemplate =
    templates.find((t) => t.isFallback) ??
    templateMap.get(defaultTemplateId) ??
    templates[0]!;

  // -------------------------------------------------------------------------
  // 0. Resolve effective attributes (stored values take precedence, fallback to inference)
  // -------------------------------------------------------------------------
  const inferredSegResult = (!recipient.hotelSegment || recipient.hotelSegment === "UNKNOWN")
    ? inferSegmentFromCompany(recipient.company, recipient.customFields, recipient.email)
    : null;
  const effectiveSegment =
    recipient.hotelSegment && recipient.hotelSegment !== "UNKNOWN"
      ? recipient.hotelSegment
      : (inferredSegResult && inferredSegResult.value !== "UNKNOWN" ? inferredSegResult.value : null);
  const effectiveSegmentStatus = recipient.hotelSegmentStatus ?? (inferredSegResult ? inferredSegResult.status : null);
  const effectiveSegmentConfidence = recipient.hotelSegmentConfidence ?? (inferredSegResult ? inferredSegResult.confidence : null);

  const inferredPersonaResult = (!recipient.contactPersona || recipient.contactPersona === "UNKNOWN")
    ? inferPersonaFromTitle(recipient.title)
    : null;
  const effectivePersona =
    recipient.contactPersona && recipient.contactPersona !== "UNKNOWN"
      ? recipient.contactPersona
      : (inferredPersonaResult && inferredPersonaResult.value !== "UNKNOWN" ? inferredPersonaResult.value : null);
  const effectivePersonaStatus = recipient.contactPersonaStatus ?? (inferredPersonaResult ? inferredPersonaResult.status : null);
  const effectivePersonaConfidence = recipient.contactPersonaConfidence ?? (inferredPersonaResult ? inferredPersonaResult.confidence : null);

  // -------------------------------------------------------------------------
  // 1. Check manual override for this contact
  // -------------------------------------------------------------------------
  const override =
    overrides instanceof Map
      ? overrides.get(recipient.id)
      : overrides?.[recipient.id];

  if (override) {
    const overriddenTemplate = templateMap.get(override.templateId);
    if (overriddenTemplate) {
      const reasonDetail = override.reason ? `: ${override.reason}` : "";
      return {
        templateId: overriddenTemplate.id,
        templateName: overriddenTemplate.name,
        template: overriddenTemplate,
        assignmentSource: "OVERRIDE",
        ruleId: null,
        rulePriority: null,
        explanation: `Manual override${reasonDetail}`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 2. Evaluate priority rules (ascending: priority 1 comes before priority 2)
  // -------------------------------------------------------------------------
  const sortedRules = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sortedRules) {
    const targetTemplate = templateMap.get(rule.templateId);
    if (!targetTemplate) {
      // Rule points to an archived or removed template; skip
      continue;
    }

    const matchReasons: string[] = [];
    let ruleMatched = true;

    // Check Hotel Segment / Organization Category
    if (rule.hotelSegment && rule.hotelSegment.trim()) {
      const ruleSegUpper = rule.hotelSegment.toUpperCase().trim();
      if (ruleSegUpper === "HOTEL") {
        const isHotel =
          effectiveSegment &&
          !["CO_PARTNERSHIP", "INSTITUTE", "UNKNOWN"].includes(effectiveSegment.toUpperCase());
        if (!isHotel) {
          ruleMatched = false;
        } else {
          matchReasons.push("Hotels & Hospitality");
        }
      } else {
        const expectedSegment = normalizeHotelSegment(rule.hotelSegment);
        const recipientSegment = normalizeHotelSegment(effectiveSegment);

        if (expectedSegment !== recipientSegment) {
          ruleMatched = false;
        } else {
          if (rule.requiresVerified && !isVerifiedStatus(effectiveSegmentStatus)) {
            ruleMatched = false;
          } else if (
            rule.minConfidence !== null &&
            rule.minConfidence !== undefined &&
            (effectiveSegmentConfidence ?? 0) < rule.minConfidence
          ) {
            ruleMatched = false;
          } else {
            const verifiedBadge = isVerifiedStatus(effectiveSegmentStatus) ? " [verified]" : "";
            matchReasons.push(`Segment '${rule.hotelSegment}'${verifiedBadge}`);
          }
        }
      }
    }

    if (!ruleMatched) continue;

    // Check Contact Persona
    if (rule.contactPersona && rule.contactPersona.trim()) {
      const expectedPersona = normalizeContactPersona(rule.contactPersona);
      const recipientPersona = normalizeContactPersona(effectivePersona);

      if (expectedPersona !== recipientPersona) {
        ruleMatched = false;
      } else {
        if (rule.requiresVerified && !isVerifiedStatus(effectivePersonaStatus)) {
          ruleMatched = false;
        } else if (
          rule.minConfidence !== null &&
          rule.minConfidence !== undefined &&
          (effectivePersonaConfidence ?? 0) < rule.minConfidence
        ) {
          ruleMatched = false;
        } else {
          const verifiedBadge = isVerifiedStatus(effectivePersonaStatus) ? " [verified]" : "";
          matchReasons.push(`Persona '${rule.contactPersona}'${verifiedBadge}`);
        }
      }
    }

    if (!ruleMatched) continue;

    // Check City
    if (rule.city && rule.city.trim()) {
      const recipientCity = recipient.customFields?.city ?? "";
      if (recipientCity.toLowerCase().trim() !== rule.city.toLowerCase().trim()) {
        ruleMatched = false;
      } else {
        matchReasons.push(`City '${rule.city}'`);
      }
    }

    if (ruleMatched && (matchReasons.length > 0 || (!rule.hotelSegment && !rule.contactPersona && !rule.city))) {
      const desc = rule.description ? ` (${rule.description})` : "";
      const matchText = matchReasons.length > 0 ? `matched ${matchReasons.join(", ")}` : "all recipients at this priority";
      return {
        templateId: targetTemplate.id,
        templateName: targetTemplate.name,
        template: targetTemplate,
        assignmentSource: "RULE",
        ruleId: rule.id,
        rulePriority: rule.priority,
        explanation: `Rule #${rule.priority}${desc}: ${matchText}`,
      };
    }
  }

  // -------------------------------------------------------------------------
  // 3. Smart Audience Vertical Routing (Automatic cross-vertical segregation)
  // -------------------------------------------------------------------------
  // When no explicit rules match:
  // If the campaign has a template specifically tailored to the recipient's vertical
  // (Co-Partnership, Institute/Hiring, or Hotel property), automatically route to it.
  const recipientVertical: "INSTITUTE" | "CO_PARTNERSHIP" | "HOTEL" | "GENERAL" =
    effectiveSegment === "CO_PARTNERSHIP" || effectivePersona === "PARTNERSHIP_DIRECTOR"
      ? "CO_PARTNERSHIP"
      : effectiveSegment === "INSTITUTE" ||
        effectivePersona === "PLACEMENT_OFFICER" ||
        effectivePersona === "DEAN_DIRECTOR"
      ? "INSTITUTE"
      : effectiveSegment && !["CO_PARTNERSHIP", "INSTITUTE", "UNKNOWN"].includes(effectiveSegment.toUpperCase())
      ? "HOTEL"
      : "GENERAL";

  if (recipientVertical !== "GENERAL" && templates.length > 1) {
    const fallbackVertical = detectTemplateVertical(fallbackTemplate);
    const fallbackMismatch = fallbackVertical !== "GENERAL" && fallbackVertical !== recipientVertical;

    if (rules.length === 0 || fallbackMismatch) {
      const verticalMatchedTpl = templates.find((t) => {
        if (detectTemplateVertical(t) !== recipientVertical) return false;
        if (recipientVertical === "HOTEL") {
          const nameLower = t.name.toLowerCase();
          if (nameLower.includes("luxury") && effectiveSegment !== "LUXURY") return false;
          if (nameLower.includes("boutique") && effectiveSegment !== "BOUTIQUE") return false;
          if (nameLower.includes("resort") && effectiveSegment !== "RESORT") return false;
          if (nameLower.includes("revpar") && effectivePersona !== "REVENUE_MANAGER") return false;
        }
        return true;
      });

      if (verticalMatchedTpl && verticalMatchedTpl.id !== fallbackTemplate.id) {
        const audienceLabels: Record<string, string> = {
          CO_PARTNERSHIP: "Co-Partnership & Brand Partner",
          INSTITUTE: "Campus & Hiring Outreach",
          HOTEL: "Hotel Property",
        };
        return {
          templateId: verticalMatchedTpl.id,
          templateName: verticalMatchedTpl.name,
          template: verticalMatchedTpl,
          assignmentSource: "RULE",
          ruleId: null,
          rulePriority: null,
          explanation: `Audience segregation: ${audienceLabels[recipientVertical] ?? recipientVertical} matched to '${verticalMatchedTpl.name}'`,
        };
      }
    }
  }

  // -------------------------------------------------------------------------
  // 4. Fallback handling (with safety guard against mismatching)
  // -------------------------------------------------------------------------
  let finalFallback = fallbackTemplate;
  const isPartner = effectiveSegment === "CO_PARTNERSHIP" || effectivePersona === "PARTNERSHIP_DIRECTOR";
  // Safety guard: If recipient is a partner, but the chosen fallback template is an Institute/Hiring template,
  // pick a non-hiring alternative if one exists in the campaign:
  if (isPartner && detectTemplateVertical(fallbackTemplate) === "INSTITUTE") {
    const nonHiringAlternative = templates.find((t) => detectTemplateVertical(t) !== "INSTITUTE");
    if (nonHiringAlternative) {
      finalFallback = nonHiringAlternative;
    }
  }

  const segLabel = effectiveSegment ? `Segment '${effectiveSegment}'` : "no segment";
  const perLabel = effectivePersona ? `Persona '${effectivePersona}'` : "no persona";
  return {
    templateId: finalFallback.id,
    templateName: finalFallback.name,
    template: finalFallback,
    assignmentSource: "FALLBACK",
    ruleId: null,
    rulePriority: null,
    explanation: `Fallback template: no rule matched for ${segLabel} and ${perLabel}`,
  };
}

/**
 * Batch-evaluate template assignments for a list of campaign recipients.
 * Returns map of contactId -> TemplateSelectionResult.
 */
export function evaluateCampaignRecipients(
  recipients: RecipientProfile[],
  context: SelectionContext
): Map<string, TemplateSelectionResult> {
  const results = new Map<string, TemplateSelectionResult>();
  for (const r of recipients) {
    results.set(r.id, selectTemplateForRecipient(r, context));
  }
  return results;
}
