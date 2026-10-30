// Suppression list: addresses that must never receive campaign email
import { Router } from "express";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { audit } from "../lib/audit.js";
import { ok, okPage, searchParam, skipTake } from "../lib/http.js";
import { toSuppressionDto } from "../lib/serialize.js";
import { IdSchema, PaginationQuerySchema, SuppressionInputSchema, SuppressionReasonSchema } from "../../shared/types.js";

const router = Router();

router.get(
  "/",
  requirePermission("suppressions.view"),
  asyncHandler(async (req, res) => {
    const { page, pageSize } = PaginationQuerySchema.parse(req.query);
    const search = searchParam(req.query.search);
    const reason = SuppressionReasonSchema.optional().parse(searchParam(req.query.reason));
    const where: Prisma.SuppressionEntryWhereInput = {
      ...(search ? { email: { contains: search, mode: "insensitive" } } : {}),
      ...(reason ? { reason } : {}),
    };
    const [rows, total] = await Promise.all([
      prisma.suppressionEntry.findMany({ where, orderBy: { createdAt: "desc" }, ...skipTake(page, pageSize) }),
      prisma.suppressionEntry.count({ where }),
    ]);
    okPage(res, rows.map(toSuppressionDto), page, pageSize, total);
  })
);

router.post(
  "/",
  requirePermission("suppressions.add"),
  asyncHandler(async (req, res) => {
    const input = SuppressionInputSchema.parse(req.body);
    const existing = await prisma.suppressionEntry.findUnique({ where: { email: input.email } });
    if (existing) throw AppError.conflict("DUPLICATE", "This address is already on the suppression list.");
    const entry = await prisma.suppressionEntry.create({
      data: { email: input.email, reason: input.reason, source: `manual:${req.user!.name}`, metadata: input.note ? { note: input.note } : {} },
    });
    await audit(req, { action: "suppression.add", entityType: "SuppressionEntry", entityId: entry.id, metadata: { email: entry.email, reason: entry.reason } });
    ok(res, toSuppressionDto(entry), 201);
  })
);

// Founders only: re-enables email to an address
router.delete(
  "/:id",
  requirePermission("suppressions.remove"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const entry = await prisma.suppressionEntry.delete({ where: { id } });
    await audit(req, { action: "suppression.remove", entityType: "SuppressionEntry", entityId: id, metadata: { email: entry.email, reason: entry.reason } });
    ok(res, { id });
  })
);

export default router;
