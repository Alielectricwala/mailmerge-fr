// Password hashing and session management for organization users
import crypto from "crypto";
import { promisify } from "util";
import prisma from "../db.js";
import { SESSION_TTL_DAYS, SessionUser } from "../../shared/auth.js";

const scrypt = promisify(crypto.scrypt) as (
  password: crypto.BinaryLike,
  salt: crypto.BinaryLike,
  keylen: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

// ============================================================================
// PASSWORDS (scrypt; format: scrypt$N$r$p$salt$hash, base64url)
// ============================================================================

const SCRYPT = { N: 2 ** 15, r: 8, p: 1, keylen: 64, maxmem: 64 * 1024 * 1024 };

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
  return ["scrypt", SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString("base64url"), hash.toString("base64url")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, saltB64, hashB64] = stored.split("$");
  if (scheme !== "scrypt" || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, "base64url");
  const actual = await scrypt(password, Buffer.from(saltB64, "base64url"), expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: SCRYPT.maxmem,
  });
  return crypto.timingSafeEqual(actual, expected);
}

// Verified against when the email is unknown, so response time doesn't reveal which accounts exist
let dummyHash: Promise<string> | null = null;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(crypto.randomBytes(16).toString("hex"));
  return dummyHash;
}

// ============================================================================
// SESSIONS (raw token lives only in the cookie; DB stores its SHA-256)
// ============================================================================

const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;
const LAST_SEEN_THROTTLE_MS = 5 * 60 * 1000;
const SESSION_CACHE_TTL_MS = 60 * 1000; // 60s memory cache for session verification to eliminate remote DB contention

interface CachedSession {
  user: SessionUser;
  expiresAt: number;
  cachedAt: number;
}

const sessionCache = new Map<string, CachedSession>();

export function clearSessionCache(): void {
  sessionCache.clear();
}

function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export async function createSession(
  userId: string,
  meta: { ipAddress?: string; userAgent?: string }
): Promise<{ token: string; expiresAt: Date }> {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  await prisma.session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
  });
  return { token, expiresAt };
}

/** Returns the session's user if the token is valid, unexpired and the user is active. */
export async function getSessionUser(token: string): Promise<SessionUser | null> {
  const tokenH = hashToken(token);
  const now = Date.now();
  const cached = sessionCache.get(tokenH);
  if (cached) {
    if (cached.expiresAt > now && now - cached.cachedAt < SESSION_CACHE_TTL_MS) {
      return cached.user;
    }
    sessionCache.delete(tokenH);
  }

  const session = await prisma.session.findUnique({
    where: { tokenHash: tokenH },
    include: { user: true },
  });
  if (!session) return null;

  if (session.expiresAt < new Date()) {
    sessionCache.delete(tokenH);
    prisma.session.delete({ where: { id: session.id } }).catch(() => undefined);
    return null;
  }
  if (session.user.status !== "ACTIVE") {
    sessionCache.delete(tokenH);
    return null;
  }

  // Update lastSeenAt asynchronously in the background so it never adds latency to user requests
  if (now - session.lastSeenAt.getTime() > LAST_SEEN_THROTTLE_MS) {
    prisma.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } }).catch(() => undefined);
  }

  const sessionUser = toSessionUser(session.user);
  sessionCache.set(tokenH, {
    user: sessionUser,
    expiresAt: session.expiresAt.getTime(),
    cachedAt: now,
  });

  return sessionUser;
}

export async function revokeSession(token: string): Promise<void> {
  const tokenH = hashToken(token);
  sessionCache.delete(tokenH);
  await prisma.session.deleteMany({ where: { tokenHash: tokenH } });
}

export async function revokeAllSessions(userId: string): Promise<void> {
  sessionCache.clear();
  await prisma.session.deleteMany({ where: { userId } });
}

// ============================================================================
// SINGLE-USE TOKENS (invites, password resets) — stored as SHA-256, raw token only in the link
// ============================================================================

export async function createAuthToken(userId: string, purpose: "INVITE" | "PASSWORD_RESET", ttlHours: number): Promise<string> {
  const token = crypto.randomBytes(32).toString("base64url");
  // Only the newest token of each purpose stays valid
  await prisma.authToken.updateMany({ where: { userId, purpose, usedAt: null }, data: { usedAt: new Date() } });
  await prisma.authToken.create({
    data: { userId, purpose, tokenHash: hashToken(token), expiresAt: new Date(Date.now() + ttlHours * 60 * 60 * 1000) },
  });
  return token;
}

/** Looks up an unused, unexpired token without consuming it */
export async function findAuthToken(token: string, purpose: "INVITE" | "PASSWORD_RESET") {
  const row = await prisma.authToken.findUnique({ where: { tokenHash: hashToken(token) }, include: { user: true } });
  if (!row || row.purpose !== purpose || row.usedAt || row.expiresAt < new Date()) return null;
  return row;
}

/** Atomically consumes a token; returns false if it was already used */
export async function consumeAuthToken(id: string): Promise<boolean> {
  const { count } = await prisma.authToken.updateMany({ where: { id, usedAt: null }, data: { usedAt: new Date() } });
  return count === 1;
}

export function toSessionUser(user: {
  id: string;
  email: string;
  name: string;
  role: SessionUser["role"];
  status: SessionUser["status"];
  senderName?: string | null;
  sendingEmail?: string | null;
}): SessionUser {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    status: user.status,
    senderName: user.senderName ?? null,
    sendingEmail: user.sendingEmail ?? null,
  };
}

// ============================================================================
// LOGIN THROTTLE (in-memory; single server process)
// ============================================================================

const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_FAILURES = 10;
const failures = new Map<string, { count: number; resetAt: number }>();

export function isLoginThrottled(key: string): boolean {
  const entry = failures.get(key);
  if (!entry) return false;
  if (entry.resetAt < Date.now()) {
    failures.delete(key);
    return false;
  }
  return entry.count >= LOGIN_MAX_FAILURES;
}

export function recordLoginFailure(key: string): void {
  const entry = failures.get(key);
  if (!entry || entry.resetAt < Date.now()) {
    failures.set(key, { count: 1, resetAt: Date.now() + LOGIN_WINDOW_MS });
  } else {
    entry.count++;
  }
}

export function clearLoginFailures(key: string): void {
  failures.delete(key);
}
