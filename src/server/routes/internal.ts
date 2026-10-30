// /api/internal/tick — runs a sending burst on serverless deployments.
// Called by Vercel Cron (GET), an external scheduler, or the previous burst (POST), always with
// "Authorization: Bearer <CRON_SECRET>". Responds immediately; the burst continues in the background.
import crypto from "crypto";
import { Router, type Request } from "express";
import { env, isServerless } from "../config.js";
import { AppError } from "../middleware/error-handler.js";
import { runBurstInBackground } from "../services/background.js";

export const internalRouter = Router();

function authorized(req: Request): boolean {
  if (!env.CRON_SECRET) return false;
  const given = Buffer.from(req.get("authorization") ?? "");
  const expected = Buffer.from(`Bearer ${env.CRON_SECRET}`);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

internalRouter.all("/tick", (req, res, next) => {
  if (!env.CRON_SECRET) return next(new AppError("NOT_CONFIGURED", "CRON_SECRET isn't set on the server.", 503));
  if (!authorized(req)) return next(AppError.unauthorized("BAD_CRON_SECRET", "Not authorized."));
  if (!isServerless) {
    return res.json({ success: true, data: { started: false, reason: "This server runs a continuous worker; ticks aren't needed." } });
  }
  runBurstInBackground();
  res.status(202).json({ success: true, data: { started: true } });
});
