# Team, roles and sign-in

## Roles

One organization, many members; each has exactly one role.

| Role | Can | Cannot |
|---|---|---|
| **Founder** | Everything | — |
| **Employee** | Contacts, lists, templates, drafts, submit for approval, test sends, start/pause approved campaigns, add suppressions | Approve campaigns, remove suppressions, change settings, manage the team, view activity |

The permission matrix lives in `src/shared/auth.ts` and is used by both the server (`requirePermission`) and the UI. Change it there only. The role and status enums are duplicated in `prisma/schema.prisma`; keep them in sync.

Rules:
- The team always keeps at least one active founder. Demoting or disabling the last one is refused.
- Nobody can disable themselves or remove their own founder role.
- Members are disabled, never deleted. Approvals and activity entries keep their author.
- `FOUNDER_SELF_APPROVAL_ALLOWED = true`: a founder may approve a campaign they submitted. Set it to `false` to require a second founder.
- Changing someone's role or disabling them signs them out everywhere.

## Sign-in & sessions

- Passwords: scrypt (N=2^15), at least 12 characters. Failed sign-ins are throttled: 10 per 15 minutes per IP and email.
- Sessions: a random 32-byte token in an `httpOnly`, `SameSite=Lax` cookie (`Secure` in production), 14-day lifetime. Only its SHA-256 is stored.
- Invites and password resets use single-use hashed tokens. Invites last 7 days, resets 24 hours. Creating a new token invalidates the previous one.
- Changing or resetting a password signs out every other session.

## Getting people in

- **First founder:** `npm run user:create -- --email … --name "…" --role FOUNDER` prints an invite link.
- **Everyone else:** a founder uses Settings → Team → Invite. The link is shown for copying and, optionally, emailed from the mailbox.
- **Forgotten password:** a founder opens the member's menu → "Send password reset link".
- **Local demos:** `npm run db:seed-demo` creates demo accounts with fresh random passwords and prints them to the terminal. Keep those passwords private. It refuses to run in production.
