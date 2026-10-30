// Email templates
import { Router } from "express";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import prisma from "../db.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { audit } from "../lib/audit.js";
import { ok, searchParam } from "../lib/http.js";
import { toTemplateDto } from "../lib/serialize.js";
import { validateTemplate } from "../../shared/merge.js";
import { IdSchema, TemplateInputSchema } from "../../shared/types.js";
import { TemplateDraftRequestSchema } from "../../shared/template-writer.js";
import { env } from "../config.js";
import { draftWithGemini, generateBotDraft, writerContext, writerFields } from "../services/template-ai.js";

const router = Router();
const withCount = { _count: { select: { campaigns: true } } } as const;

function assertValid(parts: { subject: string; bodyHtml: string; bodyText?: string | null }) {
  const errors = validateTemplate(parts);
  if (errors.length) throw AppError.badRequest("TEMPLATE_INVALID", errors[0]!, { errors });
}

router.get(
  "/",
  asyncHandler(async (req, res) => {
    const search = searchParam(req.query.search);
    const where: Prisma.TemplateWhereInput = search
      ? { OR: [{ name: { contains: search, mode: "insensitive" } }, { subject: { contains: search, mode: "insensitive" } }] }
      : {};
    const templates = await prisma.template.findMany({ where, orderBy: { updatedAt: "desc" }, include: withCount });
    ok(res, templates.map(toTemplateDto));
  })
);

// ---------------------------------------------------------------------------
// Template writer (registered before "/:id")
// ---------------------------------------------------------------------------

/** Fields the workspace can personalize with, and whether AI drafting is available */
router.get(
  "/ai/context",
  asyncHandler(async (_req, res) => {
    ok(res, await writerContext());
  })
);

// Counted from the audit log, so the limit holds across restarts and serverless instances
const AI_DRAFTS_PER_HOUR_PER_PERSON = 30;
const AI_DRAFTS_PER_DAY = 300;

router.post(
  "/ai/draft",
  requirePermission("templates.manage"),
  asyncHandler(async (req, res) => {
    const input = TemplateDraftRequestSchema.parse(req.body);
    const hourAgo = new Date(Date.now() - 3600_000);
    const dayAgo = new Date(Date.now() - 86_400_000);
    const [mine, all] = await Promise.all([
      prisma.auditLog.count({ where: { action: "template.ai_draft", userId: req.user!.id, createdAt: { gte: hourAgo } } }),
      prisma.auditLog.count({ where: { action: "template.ai_draft", createdAt: { gte: dayAgo } } }),
    ]);
    if (mine >= AI_DRAFTS_PER_HOUR_PER_PERSON) throw new AppError("AI_LIMIT", `You've made ${mine} AI drafts in the last hour. Try again later, or use a starter template.`, 429);
    if (all >= AI_DRAFTS_PER_DAY) throw new AppError("AI_LIMIT", "The workspace reached today's AI draft limit. Try again tomorrow, or use a starter template.", 429);

    const fields = await writerFields();
    let draft;
    try {
      draft = await draftWithGemini(input, fields);
    } catch (err) {
      console.warn("[templates] Gemini drafting failed; falling back to intelligent template engine:", (err as Error).message);
      draft = generateBotDraft(input, fields);
    }

    await audit(req, {
      action: "template.ai_draft",
      entityType: "Template",
      metadata: { model: draft.model || env.GEMINI_MODEL, tone: input.tone, length: input.length, briefChars: input.brief.length, withExample: Boolean(input.example), warnings: draft.warnings.length },
    });
    ok(res, draft);
  })
);

router.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const template = await prisma.template.findUnique({ where: { id }, include: withCount });
    if (!template) throw AppError.notFound("TEMPLATE_NOT_FOUND", "That template no longer exists.");
    ok(res, toTemplateDto(template));
  })
);

async function findUniqueTemplateName(baseName: string, excludeId?: string): Promise<string> {
  const trimmed = baseName.trim() || "Untitled template";
  let candidate = trimmed;
  let counter = 2;

  const match = trimmed.match(/^(.*?)\s*\((\d+)\)$/);
  let prefix = trimmed;
  if (match) {
    prefix = match[1]!.trim();
    counter = parseInt(match[2]!, 10) + 1;
  }

  while (true) {
    const existing = await prisma.template.findUnique({ where: { name: candidate } });
    if (!existing || (excludeId && existing.id === excludeId)) {
      return candidate;
    }
    candidate = `${prefix} (${counter})`;
    counter++;
  }
}

router.post(
  "/",
  requirePermission("templates.manage"),
  asyncHandler(async (req, res) => {
    const input = TemplateInputSchema.parse(req.body);
    assertValid(input);
    const name = await findUniqueTemplateName(input.name);
    const template = await prisma.template.create({ data: { ...input, name }, include: withCount });
    await audit(req, { action: "template.create", entityType: "Template", entityId: template.id, metadata: { name: template.name } });
    ok(res, toTemplateDto(template), 201);
  })
);

router.patch(
  "/:id",
  requirePermission("templates.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const input = TemplateInputSchema.partial().parse(req.body);
    const existing = await prisma.template.findUnique({ where: { id } });
    if (!existing) throw AppError.notFound("TEMPLATE_NOT_FOUND", "That template no longer exists.");
    const next = {
      subject: input.subject ?? existing.subject,
      bodyHtml: input.bodyHtml ?? existing.bodyHtml,
      bodyText: input.bodyText !== undefined ? input.bodyText : existing.bodyText,
    };
    assertValid(next);
    const contentChanged = next.subject !== existing.subject || next.bodyHtml !== existing.bodyHtml || next.bodyText !== existing.bodyText;
    let name = input.name;
    if (input.name && input.name.trim() !== existing.name) {
      name = await findUniqueTemplateName(input.name, id);
    }
    const template = await prisma.template.update({
      where: { id },
      data: {
        ...input,
        ...(name ? { name } : {}),
        ...(contentChanged ? { version: { increment: 1 } } : {}),
      },
      include: withCount,
    });
    await audit(req, { action: "template.update", entityType: "Template", entityId: id, metadata: { name: template.name, version: template.version } });
    ok(res, toTemplateDto(template));
  })
);

router.post(
  "/:id/duplicate",
  requirePermission("templates.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const source = await prisma.template.findUnique({ where: { id } });
    if (!source) throw AppError.notFound("TEMPLATE_NOT_FOUND", "That template no longer exists.");
    let name = `${source.name} (copy)`;
    for (let n = 2; await prisma.template.findUnique({ where: { name } }); n++) name = `${source.name} (copy ${n})`;
    const copy = await prisma.template.create({
      data: { name, subject: source.subject, bodyHtml: source.bodyHtml, bodyText: source.bodyText, description: source.description },
      include: withCount,
    });
    await audit(req, { action: "template.duplicate", entityType: "Template", entityId: copy.id, metadata: { from: source.name } });
    ok(res, toTemplateDto(copy), 201);
  })
);

router.delete(
  "/:id",
  requirePermission("templates.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const [usedInCampaign, usedInMulti, usedInRules] = await Promise.all([
      prisma.campaign.count({ where: { templateId: id } }),
      prisma.campaignTemplate.count({ where: { templateId: id } }),
      prisma.campaignRule.count({ where: { templateId: id } }),
    ]);
    const totalUses = usedInCampaign + usedInMulti + usedInRules;
    if (totalUses > 0) {
      throw AppError.conflict("TEMPLATE_IN_USE", `This template is used by ${usedInCampaign || usedInMulti} campaign(s) and ${usedInRules} targeting rule(s). Remove it from those campaigns first, or duplicate it.`);
    }
    const template = await prisma.template.delete({ where: { id } });
    await audit(req, { action: "template.delete", entityType: "Template", entityId: id, metadata: { name: template.name } });
    ok(res, { id });
  })
);

/** Server-side validation, for clients that want the authoritative answer */
router.post(
  "/validate",
  asyncHandler(async (req, res) => {
    const parts = z.object({ subject: z.string(), bodyHtml: z.string(), bodyText: z.string().optional().nullable() }).parse(req.body);
    ok(res, { errors: validateTemplate(parts) });
  })
);

export default router;
