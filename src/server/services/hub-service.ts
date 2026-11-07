// Sign-in through the Focus Realm Workspace (hub mode). The Workspace signs the person in with the
// employee ID and password the HR console issued, then sends them to /mail/sso with a launch ticket.
// This service checks the ticket and maps the person onto a Mail Merge account. See docs/AUTH.md.
import crypto from "crypto";
import { Prisma, type User } from "@prisma/client";
import { z } from "zod";
import prisma from "../db.js";
import { AppError } from "../middleware/error-handler.js";
import { MIN_ACTIVE_FOUNDERS, type UserRole } from "../../shared/auth.js";
import { hashToken } from "./auth-service.js";
import { activeFounderCount } from "./team-service.js";

// ============================================================================
// LAUNCH TICKETS
// base64url(JSON payload) + "." + base64url(HMAC-SHA256(FOCUS_REALM_HUB_SECRET, <that first part>)).
// The HMAC covers the base64url TEXT. Same format as the Workspace's src/lib/hub/ticket.ts.
// ============================================================================

export const HUB_TICKET_APP = "mail";
const MAX_LIFETIME_SECONDS = 120;
const CLOCK_SKEW_SECONDS = 30;

const PayloadSchema = z.object({
  v: z.literal(1),
  app: z.string(),
  /** Workspace employee ID, e.g. FR-0042 */
  sub: z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9-]{1,31}$/),
  name: z.string().trim().min(1).max(100),
  role: z.string().max(40),
  // Optional and not unique across Focus Realm; a malformed one is ignored rather than refused
  email: z.string().trim().toLowerCase().email().max(254).optional().catch(undefined),
  iat: z.number().int(),
  exp: z.number().int(),
});
export type HubTicketPayload = z.infer<typeof PayloadSchema>;

export type HubTicketProblem = "malformed" | "bad_signature" | "wrong_app" | "expired" | "not_yet_valid" | "too_long_lived" | "reused";

export class HubTicketError extends Error {
  constructor(public problem: HubTicketProblem) {
    super(`Launch ticket rejected: ${problem}`);
    this.name = "HubTicketError";
  }
}

const signature = (secret: string, body: string) => crypto.createHmac("sha256", secret).update(body).digest("base64url");

/** Signs a ticket the way the Workspace does — for tests and local simulation */
export function signHubTicket(secret: string, payload: Record<string, unknown>): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${signature(secret, body)}`;
}

/** Checks signature, app and timing; throws HubTicketError. Doesn't check reuse (see consumeHubTicket). */
export function verifyHubTicket(ticket: string, secret: string, now = Math.floor(Date.now() / 1000)): HubTicketPayload {
  const parts = ticket.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) throw new HubTicketError("malformed");
  const [body, sig] = parts as [string, string];

  const expected = Buffer.from(signature(secret, body));
  const given = Buffer.from(sig);
  if (given.length !== expected.length || !crypto.timingSafeEqual(given, expected)) throw new HubTicketError("bad_signature");

  let json: unknown;
  try {
    json = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    throw new HubTicketError("malformed");
  }
  const parsed = PayloadSchema.safeParse(json);
  if (!parsed.success) throw new HubTicketError("malformed");
  const payload = parsed.data;

  if (payload.app !== HUB_TICKET_APP) throw new HubTicketError("wrong_app");
  if (payload.exp <= now) throw new HubTicketError("expired");
  if (payload.iat > now + CLOCK_SKEW_SECONDS) throw new HubTicketError("not_yet_valid");
  if (payload.exp - payload.iat > MAX_LIFETIME_SECONDS) throw new HubTicketError("too_long_lived");
  return payload;
}

const isUniqueViolation = (err: unknown) => err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";

/** Marks a ticket used; false if it already was. Its hash is kept until the ticket expires. */
export async function consumeHubTicket(ticket: string, exp: number): Promise<boolean> {
  await prisma.usedHubTicket.deleteMany({ where: { expiresAt: { lt: new Date() } } });
  try {
    await prisma.usedHubTicket.create({ data: { tokenHash: hashToken(ticket), expiresAt: new Date(exp * 1000) } });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

// ============================================================================
// ACCOUNTS
// ============================================================================

/** Workspace founders are founders here; everyone else (managers, employees, interns) is an employee */
export function mapHubRole(workspaceRole: string): UserRole {
  return workspaceRole.trim().toUpperCase() === "FOUNDER" ? "FOUNDER" : "EMPLOYEE";
}

/** Hub mode keeps the email/password routes off, except a founder's break-glass sign-in (ALLOW_PASSWORD_LOGIN) */
export function passwordSignInAllowed(opts: { hubMode: boolean; allowPasswordLogin: boolean; role: UserRole }): boolean {
  return !opts.hubMode || (opts.allowPasswordLogin && opts.role === "FOUNDER");
}

export interface HubSignInResult {
  user: User;
  created: boolean;
  roleChange: { from: UserRole; to: UserRole } | null;
  /** The ticket said "not a founder", but this is the last active founder, so the role stayed */
  keptLastFounder: boolean;
}

/** The ticket's email, unless someone here already uses it (Workspace mailboxes can be shared) */
async function unclaimedEmail(email: string | undefined): Promise<string | null> {
  if (!email) return null;
  return (await prisma.user.findUnique({ where: { email }, select: { id: true } })) ? null : email;
}

/**
 * Finds the account for the ticket's employee ID, or creates it. Matches on the employee ID only —
 * never on email. Refuses disabled accounts.
 */
export async function upsertHubUser(payload: HubTicketPayload): Promise<HubSignInResult> {
  const employeeCode = payload.sub.toUpperCase();
  const wanted = mapHubRole(payload.role);
  const existing = await prisma.user.findUnique({ where: { employeeCode } });

  if (!existing) {
    try {
      const user = await prisma.user.create({
        data: { employeeCode, email: await unclaimedEmail(payload.email), name: payload.name, role: wanted, status: "ACTIVE" },
      });
      return { user, created: true, roleChange: null, keptLastFounder: false };
    } catch (err) {
      // A simultaneous first sign-in won, or the email was claimed in between: go again without the email
      if (isUniqueViolation(err) && payload.email !== undefined) return upsertHubUser({ ...payload, email: undefined });
      if (isUniqueViolation(err)) return upsertHubUser(payload);
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

  const data = { name: payload.name, role, status: "ACTIVE" as const };
  const email = existing.email ? null : await unclaimedEmail(payload.email);
  let user: User;
  try {
    user = await prisma.user.update({ where: { id: existing.id }, data: email ? { ...data, email } : data });
  } catch (err) {
    if (!(email && isUniqueViolation(err))) throw err;
    user = await prisma.user.update({ where: { id: existing.id }, data });
  }
  return { user, created: false, roleChange: role !== existing.role ? { from: existing.role, to: role } : null, keptLastFounder };
}
