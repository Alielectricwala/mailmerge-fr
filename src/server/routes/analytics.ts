// Analytics routes: Template comparison, attribution, and performance insights
import { Router } from "express";
import { asyncHandler } from "../middleware/error-handler.js";
import { requirePermission } from "../middleware/session.js";
import { ok } from "../lib/http.js";
import { getCampaignAnalytics, getWorkspaceTemplateAnalytics } from "../services/analytics-service.js";
import { IdSchema, TemplateAnalyticsQuerySchema } from "../../shared/types.js";

const router = Router();

router.get(
  "/templates",
  requirePermission("templates.view"),
  asyncHandler(async (req, res) => {
    const query = TemplateAnalyticsQuerySchema.parse(req.query);
    const data = await getWorkspaceTemplateAnalytics(query);
    ok(res, data);
  })
);

router.get(
  "/campaigns/:id",
  requirePermission("campaigns.view"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const data = await getCampaignAnalytics(id);
    ok(res, data);
  })
);

export default router;
