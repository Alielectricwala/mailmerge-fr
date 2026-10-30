// Express app (no listening, no background jobs) — used by the server entry and by tests
import express, { type Request, type Response, type NextFunction } from "express";
import path from "path";
import fs from "fs";
import { env, isServerless } from "./config.js";
import { errorHandler } from "./middleware/error-handler.js";
import { loadSession, requireAuth } from "./middleware/session.js";
import { authRouter, usersRouter } from "./routes/auth.js";
import contactsRouter from "./routes/contacts.js";
import listsRouter from "./routes/lists.js";
import templatesRouter from "./routes/templates.js";
import campaignsRouter from "./routes/campaigns.js";
import suppressionsRouter from "./routes/suppressions.js";
import enrichmentRouter from "./routes/enrichment.js";
import analyticsRouter from "./routes/analytics.js";
import { activityRouter, mailboxRouter, overviewRouter } from "./routes/overview.js";
import { publicRouter } from "./routes/public.js";
import { internalRouter } from "./routes/internal.js";

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  // Behind Vercel's edge the client IP arrives in X-Forwarded-For; locally only trust loopback proxies
  app.set("trust proxy", isServerless ? true : "loopback");

  app.use((_req: Request, res: Response, next: NextFunction) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    next();
  });

  app.get("/health", (_req, res) => res.json({ success: true, data: { status: "ok" } }));

  // Public pages linked from emails
  app.use(publicRouter);

  // Background bursts on serverless (secret-authorized, no session)
  app.use("/api/internal", internalRouter);

  // API
  app.use("/api", express.json({ limit: "1mb" }), loadSession);
  app.use("/api/auth", authRouter);

  const api = express.Router();
  api.use(requireAuth);
  api.use("/overview", overviewRouter);
  api.use("/contacts", contactsRouter);
  api.use("/lists", listsRouter);
  api.use("/templates", templatesRouter);
  api.use("/campaigns", campaignsRouter);
  api.use("/suppressions", suppressionsRouter);
  api.use("/enrichment", enrichmentRouter);
  api.use("/analytics", analyticsRouter);
  api.use("/mailbox", mailboxRouter);
  api.use("/activity", activityRouter);
  api.use("/users", usersRouter);
  app.use("/api", api);

  app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, error: { code: "NOT_FOUND", message: "That endpoint doesn't exist." } });
  });

  // Production: serve the built client and let it handle its own routes
  const clientDir = path.resolve(process.cwd(), "dist/client");
  if (env.NODE_ENV === "production" && fs.existsSync(clientDir)) {
    app.use(express.static(clientDir, { index: false, maxAge: "1h" }));
    app.get("*", (_req, res) => {
      res.setHeader(
        "Content-Security-Policy",
        "default-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data: https:; frame-src 'self'; object-src 'none'; base-uri 'self'"
      );
      res.sendFile(path.join(clientDir, "index.html"));
    });
  }

  app.use(errorHandler);
  return app;
}
