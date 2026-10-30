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

## Limits to know

- **Uploads:** imports are capped at 4 MB per file (Vercel's request body limit is 4.5 MB). Split larger files.
- **Time:** one burst lasts at most about 4 minutes. At the default 20 emails per minute that's roughly 80 messages per burst, and bursts chain automatically.
- **Database connections:** keep `connection_limit=1` on the pooled URL; each function instance holds its own client.
- **Logs:** Vercel → Project → Logs. Bursts log `[background]`, `[worker]` and `[inbox]` lines.
