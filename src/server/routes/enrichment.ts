// Contact enrichment: researched details with their source, confidence and verification.
// Nothing is written to a contact until a person applies it, and a filled field is only
// replaced when they explicitly choose to overwrite it.
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { audit } from "../lib/audit.js";
import { ok } from "../lib/http.js";
import { asStringRecord, toEnrichmentDto } from "../lib/serialize.js";
import { EnrichmentInputSchema, IdSchema, STANDARD_CONTACT_FIELDS, type StandardContactField } from "../../shared/types.js";

const router = Router();

const isStandard = (field: string): field is StandardContactField => (STANDARD_CONTACT_FIELDS as readonly string[]).includes(field);

function currentValue(contact: { customFields: Prisma.JsonValue } & Record<StandardContactField, string | null>, field: string): string | null {
  if (isStandard(field)) return contact[field];
  return asStringRecord(contact.customFields)[field] ?? null;
}

router.get(
  "/contact/:contactId",
  asyncHandler(async (req, res) => {
    const contactId = IdSchema.parse(req.params.contactId);
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw AppError.notFound("CONTACT_NOT_FOUND", "That contact no longer exists.");
    const rows = await prisma.enrichment.findMany({ where: { contactId }, orderBy: { createdAt: "desc" } });
    ok(res, rows.map((e) => toEnrichmentDto(e, currentValue(contact, e.field))));
  })
);

router.post(
  "/contact/:contactId",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const contactId = IdSchema.parse(req.params.contactId);
    const input = EnrichmentInputSchema.parse(req.body);
    const contact = await prisma.contact.findUnique({ where: { id: contactId } });
    if (!contact) throw AppError.notFound("CONTACT_NOT_FOUND", "That contact no longer exists.");
    const row = await prisma.enrichment.create({
      data: {
        contactId,
        field: input.field,
        value: input.value,
        source: input.source,
        confidence: input.confidence,
        evidence: { ...(input.url ? { url: input.url } : {}), ...(input.note ? { note: input.note } : {}) },
        status: input.verified ? "MANUAL" : "GUESSED",
        createdById: req.user!.id,
        ...(input.verified ? { verifiedAt: new Date(), verifiedBy: req.user!.name } : {}),
      },
    });
    await audit(req, { action: "enrichment.add", entityType: "Contact", entityId: contactId, metadata: { field: row.field, source: row.source } });
    ok(res, toEnrichmentDto(row, currentValue(contact, row.field)), 201);
  })
);

router.post(
  "/:id/review",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const { decision } = z.object({ decision: z.enum(["verify", "reject"]) }).parse(req.body);
    const row = await prisma.enrichment.update({
      where: { id },
      data: decision === "verify" ? { status: "VERIFIED", verifiedAt: new Date(), verifiedBy: req.user!.name } : { status: "REJECTED" },
      include: { contact: true },
    });
    await audit(req, { action: `enrichment.${decision}`, entityType: "Contact", entityId: row.contactId, metadata: { field: row.field } });
    ok(res, toEnrichmentDto(row, currentValue(row.contact, row.field)));
  })
);

router.post(
  "/:id/apply",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const { overwrite } = z.object({ overwrite: z.boolean().default(false) }).parse(req.body ?? {});
    const row = await prisma.enrichment.findUnique({ where: { id }, include: { contact: true } });
    if (!row) throw AppError.notFound("ENRICHMENT_NOT_FOUND", "That detail no longer exists.");
    if (row.status !== "VERIFIED" && row.status !== "MANUAL") {
      throw AppError.badRequest("NOT_VERIFIED", "Verify this detail against its source before applying it.");
    }
    const existing = currentValue(row.contact, row.field);
    if (existing && existing !== row.value && !overwrite) {
      throw AppError.conflict("FIELD_HAS_VALUE", `The contact already has ${row.field} = "${existing}". Choose to replace it if the new value is correct.`);
    }

    const data: Prisma.ContactUpdateInput = isStandard(row.field)
      ? { [row.field]: row.value }
      : { customFields: { ...asStringRecord(row.contact.customFields), [row.field]: row.value } };
    const [contact, updated] = await prisma.$transaction([
      prisma.contact.update({ where: { id: row.contactId }, data }),
      prisma.enrichment.update({ where: { id }, data: { appliedAt: new Date() } }),
    ]);
    await audit(req, { action: "enrichment.apply", entityType: "Contact", entityId: row.contactId, metadata: { field: row.field, replaced: existing } });
    ok(res, toEnrichmentDto(updated, currentValue(contact, row.field)));
  })
);

router.delete(
  "/:id",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    await prisma.enrichment.delete({ where: { id } });
    ok(res, { id });
  })
);

export default router;
