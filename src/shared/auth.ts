// Organization roles & permissions for FocusRealm Mail Merge
// Single source of truth for both server (enforcement) and client (UI gating).
//
// Model: one organization (FocusRealm), many users. Every user has exactly one role.
// - FOUNDER:  full control, including the human approval gate for sending.
// - EMPLOYEE: day-to-day work (contacts, templates, drafting campaigns, test sends)
//             but cannot approve campaigns, manage users/settings, or un-suppress addresses.
//
// Status: structure only. Login, sessions and user management endpoints are not
// implemented yet (they return 501) — see docs/AUTH.md.

import { z } from "zod";

// Not imported from ./types: a stale compiled types.js sits beside types.ts and
// bundlers resolve "./types.js" to it.
const EmailSchema = z.string().email({ message: "Invalid email address" });

// ============================================================================
// ROLES & USER STATUS
// ============================================================================

export const UserRoleSchema = z.enum(["FOUNDER", "EMPLOYEE"]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const UserStatusSchema = z.enum(["INVITED", "ACTIVE", "DISABLED"]);
export type UserStatus = z.infer<typeof UserStatusSchema>;

export const ROLE_LABELS: Record<UserRole, string> = {
  FOUNDER: "Founder",
  EMPLOYEE: "Employee",
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  FOUNDER: "Full access. Approves campaigns before they send and manages the team and settings.",
  EMPLOYEE: "Imports contacts, writes templates, drafts campaigns and sends tests. Needs a founder's approval to send.",
};

// ============================================================================
// PERMISSIONS
// ============================================================================

export const PERMISSIONS = [
  "contacts.view",
  "contacts.manage", // import, edit, delete contacts and lists
  "templates.view",
  "templates.manage",
  "campaigns.view",
  "campaigns.manage", // create and edit drafts
  "campaigns.request_approval",
  "campaigns.approve", // the human approval gate
  "campaigns.control", // start / pause / resume / cancel an approved campaign
  "campaigns.send_test",
  "suppressions.view",
  "suppressions.add",
  "suppressions.remove", // compliance-sensitive: re-enables mail to an address
  "settings.view",
  "settings.manage",
  "users.view",
  "users.manage", // invite, change role, disable
  "audit.view",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

export const PERMISSION_LABELS: Record<Permission, string> = {
  "contacts.view": "View contacts and lists",
  "contacts.manage": "Import, edit and delete contacts",
  "templates.view": "View templates",
  "templates.manage": "Create and edit templates",
  "campaigns.view": "View campaigns and send logs",
  "campaigns.manage": "Create and edit draft campaigns",
  "campaigns.request_approval": "Submit campaigns for approval",
  "campaigns.approve": "Approve campaigns for sending",
  "campaigns.control": "Start, pause, resume and cancel approved campaigns",
  "campaigns.send_test": "Send test emails to internal addresses",
  "suppressions.view": "View the suppression list",
  "suppressions.add": "Add addresses to the suppression list",
  "suppressions.remove": "Remove addresses from the suppression list",
  "settings.view": "View settings",
  "settings.manage": "Change settings",
  "users.view": "View team members",
  "users.manage": "Invite, change roles and disable team members",
  "audit.view": "View the audit log",
};

const FOUNDER_ONLY: ReadonlySet<Permission> = new Set<Permission>([
  "campaigns.approve",
  "suppressions.remove",
  "settings.manage",
  "users.manage",
  "audit.view",
]);

export const ROLE_PERMISSIONS: Record<UserRole, ReadonlySet<Permission>> = {
  FOUNDER: new Set(PERMISSIONS),
  EMPLOYEE: new Set(PERMISSIONS.filter((p) => !FOUNDER_ONLY.has(p))),
};

export function hasPermission(role: UserRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].has(permission);
}

// ============================================================================
// ORGANIZATION RULES (enforced by the user-management service once it exists)
// ============================================================================

/** The organization must always keep at least this many active founders. */
export const MIN_ACTIVE_FOUNDERS = 1;

/**
 * Whether a founder may approve a campaign they requested themselves.
 * Allowed for a small team; flip to false to require a second founder.
 */
export const FOUNDER_SELF_APPROVAL_ALLOWED = true;

/** Disabled or invited users can never act, regardless of role. */
export function canAct(user: Pick<SessionUser, "role" | "status">, permission: Permission): boolean {
  return user.status === "ACTIVE" && hasPermission(user.role, permission);
}

// ============================================================================
// API CONTRACTS
// ============================================================================

/** The authenticated user as exposed to the client (never includes secrets). */
export const SessionUserSchema = z.object({
  id: z.string(),
  email: EmailSchema,
  name: z.string(),
  role: UserRoleSchema,
  status: UserStatusSchema,
  senderName: z.string().nullable().optional(),
  sendingEmail: z.string().nullable().optional(),
});
export type SessionUser = z.infer<typeof SessionUserSchema>;

export const LoginSchema = z.object({
  email: EmailSchema,
  password: z.string().min(1, "Password is required"),
});
export type LoginInput = z.infer<typeof LoginSchema>;

export const InviteUserSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email address"),
  name: z.string().trim().min(1, "Name is required").max(100),
  role: UserRoleSchema.default("EMPLOYEE"),
  /** Email the invite link from the mailbox; the link is always shown to the inviter too */
  sendEmail: z.boolean().default(true),
});
export type InviteUserInput = z.input<typeof InviteUserSchema>;

const PasswordSchema = z.string().min(12, "Use at least 12 characters").max(200);

export const AcceptInviteSchema = z.object({
  token: z.string().min(1),
  name: z.string().trim().min(1, "Name is required").max(100),
  password: PasswordSchema,
});

export const ResetPasswordSchema = z.object({
  token: z.string().min(1),
  password: PasswordSchema,
});

export const ChangePasswordSchema = z.object({
  currentPassword: z.string().min(1, "Enter your current password"),
  newPassword: PasswordSchema,
});

export interface TeamMemberDto extends SessionUser {
  lastLoginAt: string | null;
  createdAt: string;
  invitedBy: string | null;
}

export const UpdateUserSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  role: UserRoleSchema.optional(),
  status: z.enum(["ACTIVE", "DISABLED"]).optional(),
});
export type UpdateUserInput = z.infer<typeof UpdateUserSchema>;

export const PASSWORD_MIN_LENGTH = 12;
export const SESSION_TTL_DAYS = 14;
export const SESSION_COOKIE_NAME = "fr_session";
