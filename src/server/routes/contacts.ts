// Contacts, import, and contact detail
import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { audit } from "../lib/audit.js";
import { ok, okPage, searchParam, skipTake } from "../lib/http.js";
import { contactInclude, toContactDtos, toSendDto } from "../lib/serialize.js";
import { parseWorkbook, planImport, runImport, selectSheet, suggestMapping, validateMapping } from "../services/contact-import.js";
import { computeImportQuality, detectProspectListType } from "../services/classification.js";
import { invalidateOverviewCache } from "./overview.js";
import {
  ALL_SHEETS,
  ContactInputSchema,
  IdSchema,
  ImportConfigSchema,
  ImportOptionsSchema,
  MAX_IMPORT_BYTES,
  PaginationQuerySchema,
  type ImportPreviewDto,
} from "../../shared/types.js";

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: MAX_IMPORT_BYTES, files: 1 } });

function requireFile(file: Express.Multer.File | undefined): Express.Multer.File {
  if (!file) throw AppError.badRequest("NO_FILE", "Choose a .csv or .xlsx file to upload.");
  return file;
}

// ---------------------------------------------------------------------------
// List & search
let cachedDefaultContacts: { data: any[]; total: number; expiresAt: number } | null = null;
let cachedContactFields: { data: { name: string; count: number }[]; expiresAt: number } | null = null;
const CONTACTS_CACHE_TTL_MS = 20_000;

export function invalidateContactsCache(): void {
  cachedDefaultContacts = null;
  cachedContactFields = null;
}

// ---------------------------------------------------------------------------

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const search = searchParam(req.query.search);
    const listId = searchParam(req.query.listId);
    const filter = searchParam(req.query.filter); // "suppressed" | "no_list"

    const isDefaultQuery = !search && !listId && !filter && page === 1 && pageSize === 25;
    const now = Date.now();
    if (isDefaultQuery && cachedDefaultContacts && cachedDefaultContacts.expiresAt > now) {
      return okPage(res, cachedDefaultContacts.data, page, pageSize, cachedDefaultContacts.total);
    }

    const where: Prisma.ContactWhereInput = {};
    if (search) {
      where.OR = ["email", "firstName", "lastName", "company"].map((f) => ({ [f]: { contains: search, mode: "insensitive" } }));
    }
    if (listId) where.memberships = { some: { contactListId: listId } };
    if (filter === "no_list") where.memberships = { none: {} };
    if (filter === "suppressed") {
      const suppressed = await prisma.suppressionEntry.findMany({ select: { email: true } });
      where.email = { in: suppressed.map((s) => s.email) };
    }

    const [rows, total] = await Promise.all([
      prisma.contact.findMany({ where, include: contactInclude, orderBy: { importedAt: "desc" }, ...skipTake(page, pageSize) }),
      prisma.contact.count({ where }),
    ]);
    const dtos = await toContactDtos(rows);
    if (isDefaultQuery) {
      cachedDefaultContacts = { data: dtos, total, expiresAt: now + CONTACTS_CACHE_TTL_MS };
    }
    okPage(res, dtos, page, pageSize, total);
  })
);

/** Custom field names in use — offered as merge fields in the template editor */
router.get(
  "/fields",
  asyncHandler(async (_req, res) => {
    const now = Date.now();
    if (cachedContactFields && cachedContactFields.expiresAt > now) {
      return ok(res, cachedContactFields.data);
    }
    const rows = await prisma.$queryRaw<{ key: string; count: bigint }[]>`
      SELECT key, COUNT(*) AS count FROM contacts, jsonb_object_keys("customFields") AS key
      GROUP BY key ORDER BY count DESC, key LIMIT 100`;
    const data = rows.map((r) => ({ name: r.key, count: Number(r.count) }));
    cachedContactFields = { data, expiresAt: now + 60_000 };
    ok(res, data);
  })
);

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function readConfig(body: { config?: unknown }): unknown {
  try {
    return JSON.parse(String(body.config ?? "{}"));
  } catch {
    throw AppError.badRequest("BAD_CONFIG", "The import settings couldn't be read. Refresh and try again.");
  }
}

/** Parse the file and show one sheet (form field "sheet"), the workbook's sheets, and a suggested mapping */
router.post(
  "/import/preview",
  requirePermission("contacts.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = requireFile(req.file);
    const sheets = await parseWorkbook(file.buffer, file.originalname);
    const requested = typeof req.body.sheet === "string" && req.body.sheet ? req.body.sheet : sheets[0]!.name;
    const table = selectSheet(sheets, requested);
    const suggestedMapping = suggestMapping(table.headers);
    const suggestedListType = detectProspectListType(table.headers, table.rows.slice(0, 10));
    const qualityBreakdown = computeImportQuality(table.headers, suggestedMapping, suggestedListType);

    const data: ImportPreviewDto = {
      fileName: file.originalname,
      sheets: sheets.map((s) => ({ name: s.name, rowCount: s.rows.length, headers: s.headers })),
      sheet: requested,
      headers: table.headers,
      sampleRows: table.rows.slice(0, 5),
      totalRows: table.rows.length,
      suggestedMapping,
      suggestedListType,
      readinessScore: qualityBreakdown.score,
      qualityBreakdown,
    };
    ok(res, data);
  })
);

/** Check the email column with the chosen mapping: what's cleaned, split, duplicated, or needs fixing */
router.post(
  "/import/analyze",
  requirePermission("contacts.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = requireFile(req.file);
    const options = ImportOptionsSchema.parse(readConfig(req.body));
    const table = selectSheet(await parseWorkbook(file.buffer, file.originalname), options.sheet);
    const mapping = validateMapping(options.mapping, table.headers);
    ok(res, planImport(table, mapping, options.multiEmail, options.fixes).analysis);
  })
);

router.post(
  "/import",
  requirePermission("contacts.manage"),
  upload.single("file"),
  asyncHandler(async (req, res) => {
    const file = requireFile(req.file);
    const config = ImportConfigSchema.parse(readConfig(req.body));
    if (!config.listId && !config.newListName) throw AppError.badRequest("NO_LIST", "Choose a list to import into, or name a new one.");

    const table = selectSheet(await parseWorkbook(file.buffer, file.originalname), config.sheet);
    const mapping = validateMapping(config.mapping, table.headers);
    const result = await runImport({
      sheet: table,
      fileName: config.sheet && config.sheet !== ALL_SHEETS && config.sheet !== "CSV" ? `${file.originalname} › ${config.sheet}` : file.originalname,
      mapping,
      policy: config.duplicatePolicy,
      multiEmail: config.multiEmail,
      fixes: config.fixes,
      listId: config.listId,
      newListName: config.newListName,
      userId: req.user!.id,
    });
    await audit(req, {
      action: "contacts.import",
      entityType: "ImportBatch",
      entityId: result.id,
      metadata: { file: result.fileName, list: result.list?.name, created: result.created, updated: result.updated, skipped: result.skipped },
    });
    ok(res, result, 201);
  })
);

router.get(
  "/imports",
  asyncHandler(async (_req, res) => {
    const batches = await prisma.importBatch.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { contactList: { select: { id: true, name: true } }, createdBy: { select: { id: true, name: true } } },
    });
    ok(
      res,
      batches.map((b) => ({
        id: b.id,
        fileName: b.fileName,
        list: b.contactList,
        createdBy: b.createdBy,
        totalRows: b.totalRows,
        created: b.created,
        updated: b.updated,
        unchanged: b.unchanged,
        skipped: b.skipped,
        duplicatePolicy: b.duplicatePolicy,
        createdAt: b.createdAt.toISOString(),
      }))
    );
  })
);

// ---------------------------------------------------------------------------
// Single contact
// ---------------------------------------------------------------------------

router.post(
  "/",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const input = ContactInputSchema.parse(req.body);
    const { listIds } = z.object({ listIds: z.array(IdSchema).max(50).default([]) }).parse(req.body);
    const contact = await prisma.contact.create({
      data: {
        ...input,
        source: "manual",
        memberships: { create: listIds.map((contactListId) => ({ contactListId })) },
      },
      include: contactInclude,
    });
    await audit(req, { action: "contact.create", entityType: "Contact", entityId: contact.id, metadata: { email: contact.email } });
    ok(res, (await toContactDtos([contact]))[0], 201);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const contact = await prisma.contact.findUnique({ where: { id }, include: contactInclude });
    if (!contact) throw AppError.notFound("CONTACT_NOT_FOUND", "That contact no longer exists.");
    const sends = await prisma.send.findMany({
      where: { contactId: id, status: { not: "SKIPPED" } },
      orderBy: { createdAt: "desc" },
      take: 20,
      include: { campaign: { select: { id: true, name: true } } },
    });
    ok(res, {
      ...(await toContactDtos([contact]))[0],
      history: sends.map((s) => ({ ...toSendDto(s), campaign: s.campaign })),
    });
  })
);

router.patch(
  "/:id",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const input = ContactInputSchema.partial().parse(req.body);
    const data: Prisma.ContactUpdateInput = { ...input };
    // If a person manually updates segment or persona and doesn't specify status, mark as MANUAL
    if (input.hotelSegment !== undefined && input.hotelSegmentStatus === undefined) {
      data.hotelSegmentStatus = input.hotelSegment ? "MANUAL" : null;
      data.hotelSegmentConfidence = input.hotelSegment ? 1.0 : null;
    }
    if (input.contactPersona !== undefined && input.contactPersonaStatus === undefined) {
      data.contactPersonaStatus = input.contactPersona ? "MANUAL" : null;
      data.contactPersonaConfidence = input.contactPersona ? 1.0 : null;
    }
    const contact = await prisma.contact.update({ where: { id }, data, include: contactInclude });
    await audit(req, { action: "contact.update", entityType: "Contact", entityId: id, metadata: { email: contact.email, fields: Object.keys(input) } });
    ok(res, (await toContactDtos([contact]))[0]);
  })
);

router.patch(
  "/:id/classification",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const schema = z.object({
      hotelSegment: z.string().trim().max(100).optional().nullable(),
      hotelSegmentConfidence: z.coerce.number().min(0).max(1).optional().nullable(),
      hotelSegmentStatus: z.enum(["GUESSED", "VERIFIED", "MANUAL", "REJECTED"]).optional().nullable(),
      contactPersona: z.string().trim().max(100).optional().nullable(),
      contactPersonaConfidence: z.coerce.number().min(0).max(1).optional().nullable(),
      contactPersonaStatus: z.enum(["GUESSED", "VERIFIED", "MANUAL", "REJECTED"]).optional().nullable(),
    });
    const input = schema.parse(req.body);
    const data: Prisma.ContactUpdateInput = { ...input };
    if (input.hotelSegment !== undefined && input.hotelSegmentStatus === undefined) {
      data.hotelSegmentStatus = input.hotelSegment ? "MANUAL" : null;
      data.hotelSegmentConfidence = input.hotelSegment ? 1.0 : null;
    }
    if (input.contactPersona !== undefined && input.contactPersonaStatus === undefined) {
      data.contactPersonaStatus = input.contactPersona ? "MANUAL" : null;
      data.contactPersonaConfidence = input.contactPersona ? 1.0 : null;
    }
    const contact = await prisma.contact.update({ where: { id }, data, include: contactInclude });
    await audit(req, {
      action: "contact.classify",
      entityType: "Contact",
      entityId: id,
      metadata: { hotelSegment: contact.hotelSegment, contactPersona: contact.contactPersona },
    });
    ok(res, (await toContactDtos([contact]))[0]);
  })
);

router.post(
  "/delete",
  requirePermission("contacts.manage"),
  asyncHandler(async (req, res) => {
    const { ids } = z.object({ ids: z.array(IdSchema).min(1).max(1000) }).parse(req.body);
    const { count } = await prisma.contact.deleteMany({ where: { id: { in: ids } } });
    await audit(req, { action: "contacts.delete", entityType: "Contact", metadata: { count } });
    ok(res, { deleted: count });
  })
);

export default router;
