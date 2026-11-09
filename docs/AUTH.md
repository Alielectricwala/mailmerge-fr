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

## Signing in through the Focus Realm Workspace (hub mode)

Mail Merge can join the single Focus Realm website, next to the HR console (`/hr`) and the Sales CRM (`/crm`). The Workspace (`sehejsharm/employee-management`) is the front door: people sign in there with the **employee ID** (`FR-0042`) and password the HR console issued, and open Mail Merge from its app switcher. It's served at `<Workspace>/mail`.

Hub mode is on when both `FOCUS_REALM_HUB_SECRET` and `FOCUS_REALM_HUB_URL` are set. With either unset, everything in this document above works as before.

**How a sign-in works**

1. The Workspace's `/launch/mail` checks the person is signed in, then redirects to `/mail/sso?launch=<ticket>`.
2. The ticket is `base64url(JSON) + "." + base64url(HMAC-SHA256(FOCUS_REALM_HUB_SECRET, <first part>))`, with payload `{ v: 1, app: "mail", sub: "FR-0042", name, role, email?, iat, exp }`.
3. `GET /api/auth/hub?launch=…` (`src/server/services/hub-service.ts`) accepts it only if the signature matches, `app` is `"mail"`, it hasn't expired, `iat` is at most 30 s in the future and it lives at most 2 minutes. A ticket works once: its hash is kept in `used_hub_tickets` until it expires. A repeat from a browser already signed in as that person (a double click in the Workspace) just continues that session.
4. The account is found by **employee ID only**, never by email: Focus Realm mailboxes are shared. If there isn't one, it's created, `ACTIVE`, with the ticket's name. The ticket's email is stored only if nobody here uses it yet.
5. Roles follow the Workspace: its founders are founders here, and everyone else (managers, employees, interns) is an employee. The name and role update on every sign-in. A role change signs out the person's other sessions. The last active founder is never demoted; that's recorded in Activity instead.
6. A **disabled** account is refused: "Your Mail Merge access was switched off. Ask a founder." Founders disable and re-enable people in Settings → Team as before.
7. The session lasts **12 hours**, not 14 days, so someone offboarded in the HR console (who can no longer sign in to the Workspace) loses access within a day. The cookie is `fr_mail_session` on path `/mail`, so it never collides with the Workspace's own `fr_session`.

**What changes in hub mode**

- The sign-in page shows only **Sign in with Focus Realm**. Signing out goes back to the Workspace.
- Invites, invite acceptance, password resets and password changes are switched off (`403`). Settings → Team shows each person's employee ID and no Invite button.
- **Break-glass:** with `ALLOW_PASSWORD_LOGIN=true`, founders (only) can still use the email/password form, under "Founder password sign-in", for when the Workspace is down.
- **One address:** requests that reach this app's own domain without the Workspace's `x-focusrealm-hub` header are redirected (308) to the same page under `<Workspace>/mail`. Exceptions: `/api/internal/*` (Vercel Cron and the burst chain), `/u/*` (unsubscribe links in emails already sent) and `/health`. `middleware.js` applies this at Vercel's edge (it also covers static pages), and Express applies the same rule to the API (`src/shared/hub.ts`).
- The sidebar gets a **Focus Realm** section: Workspace and, for founders, HR console.

**Existing accounts:** an account made before hub mode has no employee ID, so a person's first Workspace sign-in would create a second, empty account. Before turning hub mode on, link each existing member: `npm run user:link -- --email you@focusrealm.com --employee-code FR-0001`. If the duplicate already exists, add `--force` to move the ID to the original account, then disable the duplicate in Settings → Team.

## Simple sign-in (SIMPLE_SIGNIN)

**Identities are not verified.** Anyone who can reach the app can sign in as any FR ID by typing it. Use this only where that's acceptable, and turn it off when it isn't (see below). The server logs a warning at startup while it's on: "Sign-in is self-declared (name + FR ID); identities are not verified."

With `SIMPLE_SIGNIN=true`, the sign-in page asks for two things: **full name** and **FR ID** (`FR-` followed by digits, e.g. `FR-0042`; typed in any case, spaces around it are ignored, stored upper case). There's no password, email, invite, reset or Workspace sign-in.

- **Accounts:** found by FR ID. A new FR ID creates an account (active, employee, the name typed, no email). An existing account keeps its stored name; the name typed is recorded in Activity. Disabled accounts are refused: "Your Mail Merge access was switched off. Ask a founder."
- **Roles:** everyone is an employee except the FR IDs in `FOUNDER_EMPLOYEE_CODES` (comma-separated), which are founders. That's re-applied at every sign-in, so role changes from Settings → Team are refused; disabling and re-enabling still work there. The last active founder is never demoted (recorded in Activity instead). With the list empty, nobody is a founder: settings, team management and approvals are out of reach, and the server warns at startup.
- **Sessions:** 12 hours, in the usual `fr_session` cookie (`HttpOnly`, `SameSite=Lax`, `Secure` in production, path `/`). Sign out is a button at the bottom of the sidebar.
- **Rate limit:** 30 sign-in attempts per IP per 15 minutes (`429` with `Retry-After` after that). The count is kept in memory, so on Vercel it's per function instance.
- **Record:** every sign-in and sign-out is in Activity with the name typed, FR ID, time, IP and user agent. Everything people do (campaigns, templates, contacts, lists, research, settings) is recorded against their account. Founders see it in Settings → Activity, with each person's name and FR ID, and can filter by person; hover an entry for its IP and browser.
- **Hub mode is off** while this is on, even if `FOCUS_REALM_HUB_SECRET`/`FOCUS_REALM_HUB_URL` are set: no redirect to the Workspace (`middleware.js` and Express), and the client is built for `/` whatever `VITE_BASE_PATH` says. The app answers at its own address.
- **Unchanged:** `/api/internal/*` still needs `CRON_SECRET`; unsubscribe links (`/u/…`) and `/health` work as before; `ALLOW_LIVE_SENDING` and `DAILY_SEND_LIMIT` apply as before. Turning simple sign-in on doesn't turn sending on.

**Turning it off:** unset `SIMPLE_SIGNIN` (or set it to `false`) and redeploy. Sign-in goes back to email and password (or the Workspace, if the hub variables are set). Accounts created by simple sign-in have no email or password, so they can't sign in that way; disable them in Settings → Team, or invite people by email. Their activity stays.

## Getting people in

In hub mode, people get in through the Workspace, and with simple sign-in by typing their name and FR ID (both above). Otherwise:

- **First founder:** `npm run user:create -- --email … --name "…" --role FOUNDER` prints an invite link.
- **Everyone else:** a founder uses Settings → Team → Invite. The link is shown for copying and, optionally, emailed from the mailbox.
- **Forgotten password:** a founder opens the member's menu → "Send password reset link".
- **Local demos:** `npm run db:seed-demo` creates demo accounts with fresh random passwords and prints them to the terminal. Keep those passwords private. It refuses to run in production.
