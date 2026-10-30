// Public, unauthenticated pages reached from emails: unsubscribe.
//   GET  /u/:token  -> confirmation page (a GET never unsubscribes, so link scanners can't)
//   POST /u/:token  -> unsubscribes; also the RFC 8058 one-click target used by mail clients
import { Router, type Response } from "express";
import express from "express";
import prisma from "../db.js";
import { asyncHandler } from "../middleware/error-handler.js";
import { escapeHtml } from "../../shared/merge.js";
import { verifyUnsubscribeToken } from "../services/unsubscribe.js";
import { brandMarkSvg } from "../lib/brand.js";

export const publicRouter = Router();
publicRouter.use(express.urlencoded({ extended: false, limit: "4kb" }));

function page(res: Response, status: number, title: string, body: string) {
  res
    .status(status)
    .set({
      "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'",
      "X-Robots-Tag": "noindex",
      "Cache-Control": "no-store",
    })
    .type("html")
    .send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(title)}</title>
<style>
  body{margin:0;background:#F4F7FC;font-family:Inter,-apple-system,Segoe UI,Roboto,Arial,sans-serif;color:#101828}
  main{max-width:440px;margin:12vh auto;padding:0 20px}
  .card{background:#fff;border:1px solid #DCE4F0;border-radius:12px;padding:32px;box-shadow:0 1px 2px rgba(16,24,40,.05)}
  h1{font-size:20px;line-height:28px;margin:0 0 8px}
  p{font-size:15px;line-height:24px;color:#475569;margin:0 0 16px}
  button{background:#2168E8;color:#fff;border:0;border-radius:8px;padding:10px 18px;font:600 15px/20px inherit;cursor:pointer}
  button:hover{background:#1958CC}
  .muted{font-size:13px;color:#64748B;margin-top:24px}
  .brand{display:flex;align-items:center;gap:8px;margin-top:20px;justify-content:center;font-size:12px;font-weight:600;color:#98A2B3;letter-spacing:.02em}
  strong{color:#101828}
</style></head><body><main><div class="card">${body}</div><div class="brand">${brandMarkSvg(18)}<span>FocusRealm</span></div></main></body></html>`);
}

async function findSend(token: string) {
  const sendId = verifyUnsubscribeToken(token);
  if (!sendId) return { kind: "invalid" as const };
  if (sendId === "test-preview") return { kind: "test" as const };
  const send = await prisma.send.findUnique({ where: { id: sendId }, include: { campaign: { select: { fromName: true } } } });
  return send ? { kind: "ok" as const, send } : { kind: "invalid" as const };
}

const INVALID = `<h1>This link isn't valid</h1><p>It may be incomplete. Copy the whole link from the email, or reply to the sender and ask to be removed.</p>`;
const TEST = `<h1>This was a test email</h1><p>Unsubscribe links in test emails don't change anything. Real campaign emails carry a working link.</p>`;

publicRouter.get(
  "/u/:token",
  asyncHandler(async (req, res) => {
    const found = await findSend(req.params.token!);
    if (found.kind === "invalid") return page(res, 404, "Link not valid", INVALID);
    if (found.kind === "test") return page(res, 200, "Test email", TEST);
    const { send } = found;
    if (send.unsubscribedAt) {
      return page(res, 200, "Unsubscribed", `<h1>You're already unsubscribed</h1><p><strong>${escapeHtml(send.email)}</strong> won't receive these emails from ${escapeHtml(send.campaign.fromName)}.</p>`);
    }
    page(
      res,
      200,
      "Unsubscribe",
      `<h1>Unsubscribe?</h1><p>Stop emails from ${escapeHtml(send.campaign.fromName)} to <strong>${escapeHtml(send.email)}</strong>.</p>
<form method="post"><button type="submit">Unsubscribe</button></form>`
    );
  })
);

publicRouter.post(
  "/u/:token",
  asyncHandler(async (req, res) => {
    const found = await findSend(req.params.token!);
    if (found.kind === "invalid") return page(res, 404, "Link not valid", INVALID);
    if (found.kind === "test") return page(res, 200, "Test email", TEST);
    const { send } = found;

    if (!send.unsubscribedAt) {
      const now = new Date();
      const oneClick = req.body?.["List-Unsubscribe"] === "One-Click";
      await prisma.$transaction([
        prisma.send.update({ where: { id: send.id }, data: { unsubscribedAt: now } }),
        prisma.sendEvent.create({ data: { sendId: send.id, type: "UNSUBSCRIBE", occurredAt: now, detail: { via: oneClick ? "one-click" : "page" } } }),
        prisma.suppressionEntry.upsert({
          where: { email: send.email },
          update: {},
          create: { email: send.email, reason: "UNSUBSCRIBE", source: oneClick ? "one-click" : "unsubscribe-page", campaignId: send.campaignId },
        }),
        prisma.auditLog.create({ data: { action: "suppression.add", entityType: "Send", entityId: send.id, metadata: { email: send.email, reason: "UNSUBSCRIBE" } } }),
      ]);
    }
    page(
      res,
      200,
      "Unsubscribed",
      `<h1>You're unsubscribed</h1><p><strong>${escapeHtml(send.email)}</strong> won't receive these emails from ${escapeHtml(send.campaign.fromName)} again.</p><p class="muted">Unsubscribed by mistake? Reply to any of their emails and ask to be added back.</p>`
    );
  })
);
