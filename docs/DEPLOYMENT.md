# Deploying to Vercel

The app deploys as one Vercel project:
- the React app is served as static files (`dist/client`);
- the Express API runs as a single Vercel Function (`api/index.js`, max 300 s);
- sending runs in **bursts**, because serverless functions don't stay running between requests.

## How sending works on Vercel

There is no long-running worker on Vercel. Sending runs in bursts of up to about 4 minutes. A database lease guarantees only one burst runs at a time; atomic claims still guarantee one email per recipient.

| Trigger | When |
|---|---|
| Someone presses **Start / Resume / Retry** | A burst starts immediately after the response (`waitUntil`) |
| A burst ends with messages still queued | It calls `/api/internal/tick` on the production URL to start the next burst |
| **Vercel Cron** (`vercel.json`) | Once a day as a safety net. Hobby allows daily cron only; on Pro, change the schedule to `*/1 * * * *` |
| An external scheduler (optional) | Any plan: call `POST https://<your-domain>/api/internal/tick` with `Authorization: Bearer <CRON_SECRET>` every 1–5 minutes, e.g. cron-job.org or a GitHub Actions schedule |

Inbox checks for bounces and replies run inside bursts when due, and from **Settings → Mailbox → Check inbox now**. To get regular checks while nothing is sending, use Pro cron or an external scheduler.

A burst interrupted mid-handoff (function timeout or crash) leaves that message "Needs review" after 15 minutes. It is never resent automatically.

## 1. Database

Create a PostgreSQL database: Vercel Marketplace → Neon, or Supabase. You need two connection strings:
- **Pooled** → `DATABASE_URL`. Append `?pgbouncer=true&connection_limit=1` if the provider uses PgBouncer, which Neon's pooled host and Supabase's port 6543 both do.
- **Direct** → `DIRECT_URL`, used only for migrations.

The first migration creates the `citext` extension; both Neon and Supabase allow it.

Use a **separate database for Preview deployments**. Preview builds never run migrations, but a preview pointed at the production database could still read and write it.

## 2. Project

1. Push the repository to GitHub, GitLab or Bitbucket (`.env` is git-ignored).
2. In Vercel: **Add New → Project → Import** the repository. `vercel.json` sets everything: Vite framework, `npm ci`, `node scripts/vercel-build.mjs`, output `dist/client`, function limits, rewrites, cron and security headers. Don't override these in the dashboard.
3. Add the environment variables below for **Production**, and separately for Preview if you use it.
4. Deploy. The build:
   - checks the required variables;
   - runs `prisma generate`;
   - applies migrations (**production only**);
   - type-checks and builds.

## 3. Environment variables

| Variable | Value |
|---|---|
| `DATABASE_URL` | Pooled connection string |
| `DIRECT_URL` | Direct connection string |
| `PUBLIC_URL` | Your production address, e.g. `https://mail.focusrealm.com`. Used in unsubscribe and invite links, and to chain bursts. Must be publicly reachable, not a protected preview URL |
| `APP_SECRET` | `openssl rand -hex 32`. Signs unsubscribe links; changing it invalidates links in emails already sent |
| `CRON_SECRET` | `openssl rand -hex 32`. Vercel Cron sends it automatically |
| `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM_EMAIL`, `SMTP_FROM_NAME` | SpaceMail account (`mail.spacemail.com`, `465`, `true`, …) |
| `ALLOW_LIVE_SENDING` | `false` until you've verified everything with test sends; then `true` |
| `DAILY_SEND_LIMIT` | Stay under your SpaceMail plan's daily limit |
| `IMAP_HOST`, `IMAP_PORT`, `IMAP_USER`, `IMAP_PASS`, `IMAP_POLL_ENABLED` | Optional bounce/reply detection |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional AI template drafting. Without a key, the template writer offers starter templates only |
| `FOCUS_REALM_HUB_SECRET`, `FOCUS_REALM_HUB_URL` | Optional: sign in through the Focus Realm Workspace (section 6). Leave unset until then |
| `VITE_BASE_PATH` | Optional, build-time: `/mail/` when served on the Workspace (section 6) |
| `ALLOW_PASSWORD_LOGIN` | Hub mode only: `true` lets founders use the email/password form when the Workspace is down |
| `SIMPLE_SIGNIN` | Optional: `true` replaces sign-in with name + FR ID, self-declared and not verified ([AUTH.md](AUTH.md#simple-sign-in-simple_signin)). Overrides the hub settings |
| `FOUNDER_EMPLOYEE_CODES` | Simple sign-in only: FR IDs that are founders, comma-separated, e.g. `FR-0001,FR-0002` |

Vercel sets `NODE_ENV=production` itself. That makes session cookies `Secure`, which is correct because Vercel serves HTTPS.

## 4. First founder

Create the first account against the production database from your machine:

```bash
npx vercel link
npx vercel env pull .env.production.local --environment=production   # git-ignored
npx tsx --env-file=.env.production.local src/server/scripts/create-user.ts --email you@yourdomain.com --name "Your Name" --role FOUNDER
```

Open the printed link to set your password. Invite everyone else from **Settings → Team**. Delete `.env.production.local` when you're done. Demo accounts (`npm run db:seed-demo`) refuse to run in production.

## 5. Before the first real campaign

1. Open **Settings → Mailbox → Test connection**. It signs in to SpaceMail and sends nothing.
2. Create a campaign and **Send test** to yourself. Check the email arrives and that the unsubscribe link opens on your domain.
3. Set `ALLOW_LIVE_SENDING=true` and redeploy (env changes apply on the next deployment).

## 6. Join the Focus Realm website (/mail)

Optional. Afterwards people open Mail Merge from the Workspace (`sehejsharm/employee-management`) at `<Workspace>/mail` and sign in with their HR-issued employee ID; this app's own sign-in screen goes away. How it works: [AUTH.md](AUTH.md#signing-in-through-the-focus-realm-workspace-hub-mode). Do it in this order:

1. **Deploy this app as usual**, with the hub variables unset. The build applies the migrations that add employee IDs.
2. **Link existing members** to their Workspace employee IDs, against the production database (as in section 4), so their first Workspace sign-in opens their existing account:
   ```bash
   npx tsx --env-file=.env.production.local src/server/scripts/link-employee.ts --email you@focusrealm.com --employee-code FR-0001
   ```
3. **Workspace:** deploy the `/mail` routing and `/launch/mail` (the Workspace-side change), and set `MAILMERGE_ORIGIN` to this app's **production domain** (e.g. `https://fr-mailer.vercel.app`; never a per-deployment URL, which sits behind Vercel's login). Redeploy the Workspace.
4. **This app** (Production): set
   - `FOCUS_REALM_HUB_SECRET`: copy the Workspace's value exactly;
   - `FOCUS_REALM_HUB_URL`: the Workspace's production address;
   - `VITE_BASE_PATH` = `/mail/` (it's read at build time, so it needs a new deployment);
   - `PUBLIC_URL` = `<Workspace address>/mail` (unsubscribe links in new emails go through the Workspace).
   Then **redeploy**.
5. **Check:** sign in to the Workspace and choose Mail Merge. You should land on the overview. `https://<this app>/campaigns` should now redirect to `<Workspace>/mail/campaigns`, and `https://<this app>/health` should still answer.

What keeps working on this app's own domain: Vercel Cron and the burst chain (`/api/internal/tick`; in hub mode bursts call the production domain directly, so sending doesn't depend on the Workspace), unsubscribe links in emails already sent (`/u/…`), and `/health`.

**To go back**, unset `FOCUS_REALM_HUB_SECRET`, `FOCUS_REALM_HUB_URL` and `VITE_BASE_PATH`, set `PUBLIC_URL` to this app's domain, and redeploy. People need a password again: send them reset links from Settings → Team. Unsubscribe links in emails sent during hub mode point at the Workspace, so keep its `/mail` routing in place.

## Limits to know

- **Uploads:** imports are capped at 4 MB per file (Vercel's request body limit is 4.5 MB). Split larger files.
- **Time:** one burst lasts at most about 4 minutes. At the default 20 emails per minute that's roughly 80 messages per burst, and bursts chain automatically.
- **Database connections:** keep `connection_limit=1` on the pooled URL; each function instance holds its own client.
- **Logs:** Vercel → Project → Logs. Bursts log `[background]`, `[worker]` and `[inbox]` lines.
