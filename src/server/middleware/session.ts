// Session-based authentication & authorization for organization users (founders & employees)
// loadSession: cookie -> sessions.tokenHash -> active user -> req.user
// requireAuth / requirePermission: route guards. See docs/AUTH.md.
import { Request, Response, NextFunction } from "express";
import { AppError } from "./error-handler.js";
import { env } from "../config.js";
import { canAct, Permission, SessionUser, SESSION_COOKIE_NAME } from "../../shared/auth.js";
import { getSessionUser } from "../services/auth-service.js";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function readSessionToken(req: Request): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === SESSION_COOKIE_NAME) return decodeURIComponent(rest.join("="));
  }
  return undefined;
}

export function setSessionCookie(res: Response, token: string, expiresAt: Date) {
  res.cookie(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE_NAME, { path: "/" });
}

export async function loadSession(req: Request, _res: Response, next: NextFunction) {
  try {
    const token = readSessionToken(req);
    if (token) req.user = (await getSessionUser(token)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) {
    return next(AppError.unauthorized("NOT_AUTHENTICATED", "Sign in to continue"));
  }
  if (req.user.status !== "ACTIVE") {
    return next(AppError.forbidden("ACCOUNT_INACTIVE", "This account is not active"));
  }
  next();
}

export function requirePermission(permission: Permission) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) {
      return next(AppError.unauthorized("NOT_AUTHENTICATED", "Sign in to continue"));
    }
    if (!canAct(req.user, permission)) {
      return next(
        AppError.forbidden("PERMISSION_DENIED", `Your role does not allow: ${permission}`)
      );
    }
    next();
  };
}
