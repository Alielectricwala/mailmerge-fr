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
import { audit } from "../lib/audit.js";
import { ok } from "../lib/http.js";
import { IdSchema } from "../../shared/types.js";
import {
  AcceptInviteSchema,
  ChangePasswordSchema,
  InviteUserSchema,
  LoginSchema,
  ResetPasswordSchema,
  UpdateUserSchema,
  type TeamMemberDto,
} from "../../shared/auth.js";

// Mounted at /api/auth — reachable without a session
export const authRouter = Router();

async function startSession(req: Request, res: Response, userId: string) {
  const session = await createSession(userId, { ipAddress: req.ip, userAgent: req.get("user-agent") });
  await prisma.user.update({ where: { id: userId }, data: { lastLoginAt: new Date() } });
  setSessionCookie(res, session.token, session.expiresAt);
}

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
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
    const row = await findAuthToken(req.params.token!, "INVITE");
    if (!row) throw AppError.notFound("INVITE_INVALID", "This invite link has expired or was already used. Ask a founder for a new one.");
    ok(res, { email: row.user.email, name: row.user.name, role: row.user.role });
  })
);

authRouter.post(
  "/accept-invite",
  asyncHandler(async (req, res) => {
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
    const input = ResetPasswordSchema.parse(req.body);
    const row = await findAuthToken(input.token, "PASSWORD_RESET");
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
    ok(res, await createResetLink(req, id, sendEmail));
  })
);
