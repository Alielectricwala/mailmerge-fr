// Simple sign-in (SIMPLE_SIGNIN=true): people type their full name and FR ID, with no password. Identities
// are self-declared and NOT verified; every sign-in and sign-out is recorded in Activity. See docs/AUTH.md.
import { Prisma, type User } from "@prisma/client";
import prisma from "../db.js";
import { AppError } from "../middleware/error-handler.js";
import { MIN_ACTIVE_FOUNDERS, type UserRole } from "../../shared/auth.js";
import { activeFounderCount } from "./team-service.js";

/** Everyone is an employee, except FR IDs listed in FOUNDER_EMPLOYEE_CODES */
export function roleForEmployeeCode(employeeCode: string, founderCodes: ReadonlySet<string>): UserRole {
  return founderCodes.has(employeeCode.toUpperCase()) ? "FOUNDER" : "EMPLOYEE";
}

// ============================================================================
// RATE LIMIT (in-memory, per IP: every attempt counts, successful or not)
// On serverless each function instance keeps its own count, so the limit is per instance.
// ============================================================================

export const SIMPLE_SIGNIN_LIMIT = { max: 30, windowMs: 15 * 60 * 1000 };
const attempts = new Map<string, { count: number; resetAt: number }>();

/** Counts an attempt from this IP; returns the seconds to wait if it's over the limit, else null */
export function takeSimpleSignInAttempt(ip: string, now = Date.now()): number | null {
  const entry = attempts.get(ip);
  if (!entry || entry.resetAt <= now) {
    attempts.set(ip, { count: 1, resetAt: now + SIMPLE_SIGNIN_LIMIT.windowMs });
    return null;
  }
  if (entry.count >= SIMPLE_SIGNIN_LIMIT.max) return Math.ceil((entry.resetAt - now) / 1000);
  entry.count++;
  return null;
}

/** Tests only */
export function resetSimpleSignInAttempts() {
  attempts.clear();
}

// ============================================================================
// ACCOUNTS
// ============================================================================

export interface SimpleSignInResult {
  user: User;
  created: boolean;
  roleChange: { from: UserRole; to: UserRole } | null;
  /** FOUNDER_EMPLOYEE_CODES no longer lists them, but they're the last active founder, so the role stayed */
  keptLastFounder: boolean;
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/**
 * Finds the account for an FR ID, or creates it (ACTIVE, no email, the typed name). An existing account
 * keeps its stored name. The role follows FOUNDER_EMPLOYEE_CODES on every sign-in. Disabled accounts are refused.
 */
export async function upsertSimpleUser(
  input: { name: string; employeeCode: string },
  founderCodes: ReadonlySet<string>
): Promise<SimpleSignInResult> {
  const wanted = roleForEmployeeCode(input.employeeCode, founderCodes);
  const existing = await prisma.user.findUnique({ where: { employeeCode: input.employeeCode } });

  if (!existing) {
    try {
      const user = await prisma.user.create({
        data: { employeeCode: input.employeeCode, name: input.name, role: wanted, status: "ACTIVE", email: null },
      });
      return { user, created: true, roleChange: null, keptLastFounder: false };
    } catch (err) {
      // Two first sign-ins with the same FR ID at once: the other one created it
      if (isUniqueViolation(err)) return upsertSimpleUser(input, founderCodes);
      throw err;
    }
  }

  if (existing.status === "DISABLED") {
    throw AppError.forbidden("ACCESS_DISABLED", "Your Mail Merge access was switched off. Ask a founder.");
  }

  let role = wanted;
  let keptLastFounder = false;
  const losingFounder = existing.role === "FOUNDER" && wanted !== "FOUNDER" && existing.status === "ACTIVE";
  if (losingFounder && (await activeFounderCount(existing.id)) < MIN_ACTIVE_FOUNDERS) {
    role = "FOUNDER";
    keptLastFounder = true;
  }

  const user =
    role !== existing.role || existing.status !== "ACTIVE"
      ? await prisma.user.update({ where: { id: existing.id }, data: { role, status: "ACTIVE" } })
      : existing;
  return { user, created: false, roleChange: role !== existing.role ? { from: existing.role, to: role } : null, keptLastFounder };
}
