// Auth (sign-in, invites, password) and team management
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import prisma from "../db.js";
import { asyncHandler, AppError } from "../middleware/error-handler.js";
import { clearSessionCookie, readSessionToken, requireAuth, requirePermission, setSessionCookie } from "../middleware/session.js";
import {
  clearLoginFailures,
  consumeAuthToken,
  createSession,
  findAuthToken,
  getDummyHash,
  hashPassword,
  isLoginThrottled,
  recordLoginFailure,
  revokeAllSessions,
  revokeSession,
  toSessionUser,
  verifyPassword,
} from "../services/auth-service.js";
import { createResetLink, inviteUser, updateUser } from "../services/team-service.js";
import { consumeHubTicket, HubTicketError, passwordSignInAllowed, upsertHubUser, verifyHubTicket } from "../services/hub-service.js";
import { basePath, env, hubMode } from "../config.js";
import { page } from "./public.js";
import { audit } from "../lib/audit.js";
import { ok } from "../lib/http.js";
import { IdSchema } from "../../shared/types.js";
import { escapeHtml } from "../../shared/merge.js";
import type { AuthModeDto } from "../../shared/hub.js";
import {
  AcceptInviteSchema,
  ChangePasswordSchema,
  HUB_SESSION_TTL_HOURS,
  InviteUserSchema,
  LoginSchema,
  ResetPasswordSchema,
  UpdateUserSchema,
  type TeamMemberDto,
  type UserRole,
} from "../../shared/auth.js";

// Mounted at /api/auth — reachable without a session
export const authRouter = Router();

async function startSession(req: Request, res: Response, userId: string, ttlMs?: number) {
  const session = await createSession(userId, { ipAddress: req.ip, userAgent: req.get("user-agent") }, ttlMs);
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  setSessionCookie(res, session.token, session.expiresAt);
}

// ----------------------------------------------------------------------------
// Hub mode: people sign in through the Focus Realm Workspace. See docs/AUTH.md.
// ----------------------------------------------------------------------------

const HUB_SIGN_IN = "Sign in through the Focus Realm Workspace.";

const passwordAllowedFor = (role: UserRole) =>
  passwordSignInAllowed({ hubMode, allowPasswordLogin: env.ALLOW_PASSWORD_LOGIN, role });

/** Invites and the email/password form are off in hub mode (founders keep a break-glass sign-in) */
function refuseInHubMode() {
  if (hubMode) throw AppError.forbidden("HUB_SIGN_IN", HUB_SIGN_IN);
}

authRouter.get("/mode", (_req, res) => {
  const mode: AuthModeDto = {
    hub: hubMode,
    hubUrl: hubMode ? env.FOCUS_REALM_HUB_URL! : null,
    passwordLogin: !hubMode || env.ALLOW_PASSWORD_LOGIN,
  };
  ok(res, mode);
});

const TICKET_INVALID: Record<string, string> = {
  wrong_app: "This sign-in link is for a different Focus Realm app. Open Mail Merge from the Workspace.",
  reused: "This sign-in link was already used. Open Mail Merge from the Workspace again.",
};

/**
 * GET /api/auth/hub?launch=<ticket> — the Workspace sends people to /mail/sso, whose page calls this.
 * Exchanges a launch ticket (signed, single-use, at most 2 minutes old) for a 12-hour session.
 * Answers JSON, or — when a browser opens it directly — redirects into the app / shows an error page.
 */
authRouter.get(
  "/hub",
  asyncHandler(async (req, res) => {
    const wantsPage = req.accepts(["json", "html"]) === "html";
    try {
      if (!hubMode) throw AppError.notFound("HUB_NOT_CONFIGURED", "Signing in through the Workspace isn't set up on this server.");
      const ticket = typeof req.query.launch === "string" ? req.query.launch.slice(0, 4096) : "";

      let payload;
      try {
        payload = verifyHubTicket(ticket, env.FOCUS_REALM_HUB_SECRET!);
        if (!(await consumeHubTicket(ticket, payload.exp))) {
          // A double click in the Workspace sends the same ticket twice (it has no nonce). If the first
          // one already signed this browser in as this person, carry on with that session.
          if (req.user?.employeeCode === payload.sub.toUpperCase()) {
            if (wantsPage) return res.redirect(303, basePath);
            return ok(res, req.user);
          }
          throw new HubTicketError("reused");
        }
      } catch (err) {
        if (!(err instanceof HubTicketError)) throw err;
        throw new AppError(
          "HUB_TICKET_INVALID",
          TICKET_INVALID[err.problem] ?? "This sign-in link has expired. Open Mail Merge from the Workspace again.",
          401,
          { reason: err.problem }
        );
      }

      const result = await upsertHubUser(payload);
      // A role change from the Workspace ends the old sessions, as a founder's change here does
      if (result.roleChange) await revokeAllSessions(result.user.id);
      await startSession(req, res, result.user.id, HUB_SESSION_TTL_HOURS * 60 * 60 * 1000);
      req.user = toSessionUser(result.user);

      const meta = { employeeCode: result.user.employeeCode };
      if (result.created) await audit(req, { action: "hub.user_created", entityType: "User", entityId: result.user.id, metadata: { ...meta, role: result.user.role } });
      if (result.roleChange) await audit(req, { action: "hub.role_synced", entityType: "User", entityId: result.user.id, metadata: { ...meta, ...result.roleChange } });
      if (result.keptLastFounder) await audit(req, { action: "hub.kept_last_founder", entityType: "User", entityId: result.user.id, metadata: meta });
      await audit(req, { action: "auth.hub_login", entityType: "User", entityId: result.user.id, metadata: meta });

      if (wantsPage) return res.redirect(303, basePath);
      ok(res, req.user);
    } catch (err) {
      if (!wantsPage || !(err instanceof AppError)) throw err;
      const back = env.FOCUS_REALM_HUB_URL
        ? `<p><a href="${escapeHtml(`${env.FOCUS_REALM_HUB_URL}/launch/mail`)}">Open Mail Merge from the Workspace</a></p>`
        : "";
      page(res, err.statusCode, "Couldn't sign you in", `<h1>Couldn't sign you in</h1><p>${escapeHtml(err.message)}</p>${back}`);
    }
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    if (hubMode && !env.ALLOW_PASSWORD_LOGIN) throw AppError.forbidden("HUB_SIGN_IN", HUB_SIGN_IN);
    const { email, password } = LoginSchema.parse(req.body);
    const throttleKey = `${req.ip}|${email.toLowerCase()}`;
    if (isLoginThrottled(throttleKey)) {
      throw new AppError("TOO_MANY_ATTEMPTS", "Too many sign-in attempts. Wait 15 minutes, then try again.", 429);
    }

    const user = await prisma.user.findUnique({ where: { email } });
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await getDummyHash()));
    if (!user || !user.passwordHash || !passwordOk) {
      recordLoginFailure(throttleKey);
      throw AppError.unauthorized("INVALID_CREDENTIALS", "That email and password don't match an account.");
    }
    if (user.status !== "ACTIVE") {
      throw AppError.forbidden("ACCOUNT_INACTIVE", "This account is disabled. Ask a founder to re-enable it.");
    }
    if (!passwordAllowedFor(user.role)) {
      throw AppError.forbidden("FOUNDERS_ONLY", "Password sign-in is for founders only. Sign in through the Focus Realm Workspace.");
    }

    clearLoginFailures(throttleKey);
    await startSession(req, res, user.id);
    await audit(req, { action: "auth.login", entityType: "User", entityId: user.id }).catch(() => undefined);
    ok(res, toSessionUser(user));
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = readSessionToken(req);
    if (token) await revokeSession(token);
    clearSessionCookie(res);
    ok(res, null);
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => ok(res, req.user))
);

const UpdateProfileSchema = z.object({
  name: z.string().trim().min(1, "Name is required").max(100).optional(),
  senderName: z.string().trim().max(100).optional().nullable().or(z.literal("").transform(() => null)),
  sendingEmail: z.string().trim().toLowerCase().email("Enter a valid email address").optional().nullable().or(z.literal("").transform(() => null)),
});

authRouter.patch(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const input = UpdateProfileSchema.parse(req.body);
    const updated = await prisma.user.update({
      where: { id: req.user!.id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.senderName !== undefined ? { senderName: input.senderName?.trim() || null } : {}),
        ...(input.sendingEmail !== undefined ? { sendingEmail: input.sendingEmail?.trim() || null } : {}),
      },
    });
    req.user = toSessionUser(updated);
    ok(res, req.user);
  })
);

// Invite acceptance
authRouter.get(
  "/invite/:token",
  asyncHandler(async (req, res) => {
    refuseInHubMode();
    const row = await findAuthToken(req.params.token!, "INVITE");
    if (!row) throw AppError.notFound("INVITE_INVALID", "This invite link has expired or was already used. Ask a founder for a new one.");
    ok(res, { email: row.user.email, name: row.user.name, role: row.user.role });
  })
);

authRouter.post(
  "/accept-invite",
  asyncHandler(async (req, res) => {
    refuseInHubMode();
    const input = AcceptInviteSchema.parse(req.body);
    const row = await findAuthToken(input.token, "INVITE");
    if (!row || !(await consumeAuthToken(row.id))) {
      throw AppError.notFound("INVITE_INVALID", "This invite link has expired or was already used. Ask a founder for a new one.");
    }
    const user = await prisma.user.update({
      where: { id: row.userId },
      data: { name: input.name, passwordHash: await hashPassword(input.password), status: "ACTIVE" },
    });
    await startSession(req, res, user.id);
    req.user = toSessionUser(user);
    await audit(req, { action: "team.accept_invite", entityType: "User", entityId: user.id });
    ok(res, toSessionUser(user));
  })
);

authRouter.post(
  "/reset-password",
  asyncHandler(async (req, res) => {
    if (hubMode && !env.ALLOW_PASSWORD_LOGIN) throw AppError.forbidden("HUB_SIGN_IN", HUB_SIGN_IN);
    const input = ResetPasswordSchema.parse(req.body);
    const row = await findAuthToken(input.token, "PASSWORD_RESET");
    if (row && !passwordAllowedFor(row.user.role)) throw AppError.forbidden("HUB_SIGN_IN", HUB_SIGN_IN);
    if (!row || row.user.status !== "ACTIVE" || !(await consumeAuthToken(row.id))) {
      throw AppError.notFound("RESET_INVALID", "This reset link has expired or was already used. Ask a founder for a new one.");
    }
    await prisma.user.update({ where: { id: row.userId }, data: { passwordHash: await hashPassword(input.password) } });
    await revokeAllSessions(row.userId);
    await startSession(req, res, row.userId);
    ok(res, toSessionUser(row.user));
  })
);

authRouter.post(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (!passwordAllowedFor(req.user!.role)) throw AppError.forbidden("HUB_SIGN_IN", "Your password is managed in the Focus Realm Workspace.");
    const input = ChangePasswordSchema.parse(req.body);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: req.user!.id } });
    if (!user.passwordHash || !(await verifyPassword(input.currentPassword, user.passwordHash))) {
      throw AppError.badRequest("WRONG_PASSWORD", "Your current password isn't right.");
    }
    await prisma.user.update({ where: { id: user.id }, data: { passwordHash: await hashPassword(input.newPassword) } });
    await revokeAllSessions(user.id);
    await startSession(req, res, user.id);
    await audit(req, { action: "auth.change_password", entityType: "User", entityId: user.id });
    ok(res, null);
  })
);

// Mounted at /api/users (behind requireAuth)
export const usersRouter = Router();

usersRouter.get(
  "/",
  requirePermission("users.view"),
  asyncHandler(async (_req, res) => {
    const users = await prisma.user.findMany({
      orderBy: [{ status: "asc" }, { role: "asc" }, { name: "asc" }],
      include: { invitedBy: { select: { name: true } } },
    });
    const data: TeamMemberDto[] = users.map((u) => ({
      ...toSessionUser(u),
      lastLoginAt: u.lastLoginAt?.toISOString() ?? null,
      createdAt: u.createdAt.toISOString(),
      invitedBy: u.invitedBy?.name ?? null,
    }));
    ok(res, data);
  })
);

usersRouter.post(
  "/invite",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    if (hubMode) throw AppError.forbidden("HUB_MANAGED", "People join from the HR console: they appear here the first time they open Mail Merge from the Workspace.");
    const input = InviteUserSchema.parse(req.body);
    const result = await inviteUser(req, input);
    ok(res, { user: toSessionUser(result.user), inviteUrl: result.inviteUrl, emailed: result.emailed }, 201);
  })
);

usersRouter.patch(
  "/:id",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const input = UpdateUserSchema.parse(req.body);
    if (id === req.user!.id && (input.status === "DISABLED" || input.role === "EMPLOYEE")) {
      throw AppError.badRequest("SELF_CHANGE", "You can't disable yourself or remove your own founder role.");
    }
    ok(res, toSessionUser(await updateUser(req, id, input)));
  })
);

usersRouter.post(
  "/:id/reset-link",
  requirePermission("users.manage"),
  asyncHandler(async (req, res) => {
    const id = IdSchema.parse(req.params.id);
    const { sendEmail } = z.object({ sendEmail: z.boolean().default(false) }).parse(req.body ?? {});
    if (hubMode) {
      const target = await prisma.user.findUnique({ where: { id }, select: { role: true } });
      if (!target || !passwordAllowedFor(target.role)) throw AppError.forbidden("HUB_MANAGED", "Passwords are managed in the Focus Realm Workspace.");
    }
    ok(res, await createResetLink(req, id, sendEmail));
  })
);
