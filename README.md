# FocusRealm Mail Merge

Personalized outreach from your own SpaceMail mailbox, with a founder's approval before anything sends.

**Workflow:** import contacts into a list → write a template with merge fields → create a campaign → review every recipient and send yourself a test → submit → a founder approves (content and recipients lock) → start sending → follow delivery, replies, bounces and unsubscribes per recipient.

## What's in it

| Area | What it does |
|---|---|
| **Contacts & lists** | CSV/XLSX import up to 4 MB: any sheet of a workbook or all sheets combined, column mapping, custom fields. Email cells are cleaned (several addresses split on `,` `;` `/` new lines; stray text removed), unreadable ones listed with suggested fixes to confirm, likely provider typos flagged. Duplicate policy: keep / fill blanks / overwrite; row-level report |
| **Templates** | Plain-text or HTML emails; `{{field}}` and `{{field\|fallback}}` merge fields; live preview against real contacts; validation as you type. "Write it for me": a draft from a brief via Google Gemini (optional), or starter templates built from the fields your contacts have |
| **Campaigns** | Pre-approval review (who's ready, who's missing data, who's suppressed), test sends, submit → founder approval (bound to the exact content reviewed) → start, pause, resume, cancel, retry failed |
| **Sending engine** | Database-backed queue; each recipient is claimed atomically and sent once; per-campaign pace and a mailbox-wide 24-hour limit; interrupted handoffs become "Needs review" and are never resent automatically |
| **Compliance** | Signed one-click unsubscribe (RFC 8058) plus a footer on every email; suppression list checked at approval and again right before each send |
| **Follow-up** | Optional read-only IMAP monitor detects bounce reports and replies; hard bounces are suppressed automatically |
| **Enrichment** | Researched details recorded with source, evidence link and confidence; verified by a person; applied to a contact only on request, never silently overwriting |
| **Team** | Founders and employees; invites, role changes, disable, password reset links; activity log for founders |

## Requirements

- Node.js 20+
- PostgreSQL 16 (Docker is easiest)
- A SpaceMail mailbox (SMTP; IMAP optional)

## Setup

```bash
npm install
cp .env.example .env          # then fill it in (see below)

# Database (once)
docker run --name fr-mailer-postgres -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=fr_mailer -p 5432:5432 -d postgres:16
npm run db:deploy             # applies migrations (creates the citext extension)

# First account
npm run user:create -- --email you@yourdomain.com --name "Your Name" --role FOUNDER
#   → prints an invite link; open it to set your password
# or, for local demos only:
npm run db:seed-demo          # generates local demo passwords and prints them to this terminal
```

Keep the printed demo passwords private. Local environment files, credentials, and exported data must not be committed; use `.env.example` as a template and keep real values in your local `.env` or deployment secret store.

### Environment (`.env`)

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | Use `127.0.0.1`, not `localhost`. On Windows, WSL can hold `[::1]:5432` |
| `DIRECT_URL` | Connection used by migrations. Locally the same as `DATABASE_URL`; on Vercel the non-pooled URL |
| `PORT` | API port (default 3010). The Vite dev proxy reads the same value |
| `PUBLIC_URL` | Origin used in email links (unsubscribe, invites). In production it must be reachable by recipients |
| `APP_SECRET` | 32+ random characters; signs unsubscribe links (`openssl rand -hex 32`) |
| `SMTP_*` | SpaceMail sending account. Port 465 → `SMTP_SECURE=true` |
| `ALLOW_LIVE_SENDING` | **Safety switch.** `false`: approved campaigns can't start (tests still work). Set to `true` when you're ready to send |
| `DAILY_SEND_LIMIT` | Mailbox-wide cap per rolling 24 hours. Sending waits, then resumes automatically |
| `IMAP_*`, `IMAP_POLL_ENABLED` | Read-only bounce/reply detection |
| `CRON_SECRET` | Vercel only: authorizes the sending-burst endpoint |
| `GEMINI_API_KEY`, `GEMINI_MODEL` | Optional AI drafting in the template editor. Only the brief, an example and field names are sent; never contact data |

## Run

```bash
npm run dev       # API on :3010 + web app on :5173 (proxied)
```

Production on your own server (one long-running process):

```bash
npm run build     # type-checks, then builds server and client
NODE_ENV=production npm start   # serves the app and the API from one process
```

Put it behind HTTPS (session cookies are `Secure` in production) and set `PUBLIC_URL` to that address.

**Vercel:** see [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md). `vercel.json` and `api/index.js` are already set up; sending runs in bounded bursts instead of a long-running worker.

## Tests

```bash
npm test                  # unit tests (merge engine, import parsing, SMTP outcomes, inbox classifier, auth)
npm run test:integration  # full campaign flow against a separate fr_mailer_test database
```

The integration suite resets `fr_mailer_test` (it refuses any database whose name doesn't end in `_test`) and uses a fake mail transport. It proves: one send per recipient under concurrent workers; approval freezes content; stale reviews can't be approved; crashes produce "Needs review", not resends; 550s suppress; auth failures pause; unsubscribe works.

## Project layout

```
src/shared/      merge engine, API contracts (zod), roles & permissions — used by both sides
src/server/      Express API, services (campaigns, sending worker, import, inbox, team), Prisma
src/client/      React app: design tokens (styles/tokens.css), UI kit (components/ui), pages
api/index.js     Vercel Function entry (wraps the compiled Express app)
scripts/         Vercel build script
prisma/          schema and migrations
docs/            architecture review, auth notes
```

See `docs/DEPLOYMENT.md` for Vercel, `docs/ARCHITECTURE_REVIEW.md` for design decisions and `docs/AUTH.md` for roles.
