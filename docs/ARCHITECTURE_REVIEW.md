# FocusRealm Mail Merge — Architecture Review & Decisions

> **Status (2026-10-25, after the rebuild):** sections 1–4 and 7 describe the system *before* the rebuild. They're kept as the reasoning for the decisions in §5, and those decisions are now implemented:
> - **Sending engine:** approval snapshot, `sends` table, atomic claims, `UNKNOWN` state, limits, crash recovery.
> - **Unsubscribe:** signed links with RFC 8058 one-click.
> - **Inbox:** IMAP bounce/reply detection.
> - **Import:** server-side CSV/XLSX into lists with an explicit duplicate policy.
> - **Merge engine:** one shared engine with HTML escaping.
> - **Team:** sessions, roles, invites.
> - **UI:** rebuilt on a single token-based design system.
>
> Removed: the SpaceMail webhooks, open/click tracking, DB-stored SMTP settings and API keys, and placeholder enrichment jobs.
>
> Still open: the `zod` 3 → 4 upgrade (advisory GHSA-mrhx-c7xc-m3w5; mitigated by 1 MB body limits) and an ESLint setup.

**Date:** 2026-10-25 · **Supersedes:** `PROJECT_AUDIT.md` (static-only; several of its claims are wrong — see §1.3)
**Method:** every file in `src/` and `prisma/` read; type checks, tests and build run; server started against the local Postgres container and endpoints exercised with real requests. No email was sent.

---

## 1. Baseline (observed, not assumed)

### 1.1 Checks

| Check | Result |
|---|---|
| `tsc -p tsconfig.server.json` | ✅ passes |
| `tsc -p tsconfig.client.json` | ❌ **98 errors**, including undefined identifiers that crash at runtime (`Button` in `Table.tsx`/`Modal.tsx`, `Badge`/`setEditingTemplate` in `TemplatesPage.tsx`, `FileText` in `SettingsPage.tsx`) |
| `vite build` | ✅ "passes" — it does not type-check, so it ships the errors above |
| `vitest run` | ✅ 14/14 — but one test asserts the known validation bug as expected behaviour |
| `eslint` | ❌ no config file; lint cannot run |
| `prisma migrate status` | ❌ `20261024120013_init` recorded as **failed** (`type "citext" does not exist` — migration never creates the extension). Tables exist because they were later created out-of-band. |
| Server startup | ✅ starts (with SMTP env present). Port 3001 is also used by another local project (FocusRealm Presentation Studio, on `[::]`), so `localhost:3001` silently hits the wrong app. |
| Git | No commits; no `.gitignore` before this review. |

### 1.2 Runtime probes

| Probe | Observed |
|---|---|
| Create template `Hi {{firstName}} at {{company}}` | **400** "Nested merge fields are not supported" — any template with two fields is rejected |
| `GET /api/templates` shape vs. UI access | API returns `{success, data: [...]}`; every page reads `res.data.data` → `undefined` → **every list in the UI renders empty** |
| Template preview as the UI calls it | **400** `NO_CONTACTS` (UI sends `sampleData`; server ignores it) |
| CSV import (multipart) | **400** `NO_FILE` — `multer` is imported but not installed nor mounted |
| Contact `customFields` | stored as the JSON *string* `"{}"` inside a JSONB column (double-encoded) |
| Approve as the UI calls it | **400** `approvedBy` required; UI sends no body |
| Unsubscribe URL put in every email (`{CLIENT_URL}/unsubscribe`) | **404** |
| Open-pixel URL put in every email (`{CLIENT_URL}/api/track/open`) | **404** (real route is `/webhooks/track/open`) |
| `/webhooks/track/click?url=https://evil.example` | **302 → evil.example** (open redirect) |
| `POST /api/settings/api-key` | generates and stores a key that the auth middleware never reads |

### 1.3 Corrections to `PROJECT_AUDIT.md`
Tailwind *is* used (config + classes) alongside a second token system in `tokens.css`; the client build is not clean once type-checked; `/api/settings/dashboard-stats` exists; status-transition endpoints exist; a campaign wizard exists. The audit missed every defect in §1.2 and §2.

**Net: the end-to-end workflow (import → list → template → preview → approve → send → log) cannot be completed through the UI at any step.**

---

## 2. Critical defects in the sending path

These are the reason the sending engine is being **replaced**, not patched.

1. **Test mode can mail the whole list.** `email-sender.ts:104-109` only filters when `testMode && testEmails.length > 0`. Test mode with no test addresses (a natural state) sends to every real recipient. Test mode also never *redirects* mail — it just drops real recipients who aren't on the test list.
2. **Duplicate sends are possible on several paths.**
   - Claiming a recipient is `findFirst(PENDING)` then `update(QUEUED)` — not atomic. `POST /api/sending/campaigns/:id/send`, `/resume` while the previous loop is mid-batch, or a double-clicked `/start` all spawn concurrent loops over the same rows.
   - `/start` has a non-atomic status check and `SendLog` has no unique `(campaignId, contactId)`, so a double request creates two log rows per recipient.
   - Any exception *after* SMTP accepted the message (e.g., the DB update) is recorded as `FAILED`; `retryFailedSends` then sends it again. SMTP timeouts after `DATA` are treated the same way.
3. **Pausing completes the campaign.** The loop breaks on status change, then unconditionally writes `COMPLETED`/`FAILED` (`email-sender.ts:323`), overwriting `PAUSED`/`CANCELLED`.
4. **Crash = stuck forever.** Rows left `QUEUED` after a restart are never resolved; nothing resumes `SENDING` campaigns on boot; nobody can tell whether those messages went out.
5. **Limits are fiction.** `rateLimit`, `dailyLimit`, `campaignLimit` are stored and displayed but never enforced; 50 messages go out concurrently per batch with a hardcoded 100 ms gap.
6. **Approval binds to nothing.** Templates and list membership can change after approval (only `SENDING`/`COMPLETED` campaigns are locked, `campaigns.ts:186`); the send renders whatever exists at send time. `request-approval` writes the *requester* into `approvedBy` (`campaigns.ts:365`); `approve` accepts any string as identity.
7. **Unsubscribe is broken and unsafe.** Link 404s (above). The real endpoint is unauthenticated GET keyed by guessable IDs, so link scanners/prefetchers unsubscribe people; `POST /webhooks/unsubscribe {email}` lets anyone suppress any address.
8. **Webhook design rests on an unverified premise.** No public documentation shows SpaceMail offering delivery webhooks; the payload schema and `x-spacemail-signature` header appear invented. The signature is computed over re-serialised JSON (never matches a real raw-body HMAC), `timingSafeEqual` throws on length mismatch, and verification is skipped entirely in development. The router is also mounted twice (`/api/webhooks` behind auth, `/webhooks` open).
9. **Merge values are injected into HTML unescaped**, and the template preview iframe uses `sandbox="allow-scripts allow-same-origin"`, which disables the sandbox — template HTML runs with the app's origin.
10. **Preview misses missing fields.** `campaigns.ts:309` checks `f.name in parsedContact`, but the object always has those keys (set to `undefined`), so missing `firstName`/`company` are never reported.

## 3. Other significant findings

- **Security:** dev mode disables auth when `API_KEY` is unset; the documented alternative (`VITE_API_KEY`) bakes the key into the public JS bundle. No real user identity exists, so "human approval" is unenforceable.
- **Fake features:** SMTP settings form saves the password in plain text to the DB and is never read ("restart to apply" is false); API-key generator; enrichment `/bulk` and `/jobs/:id` return hardcoded placeholders; "Connected" pill in the header is static; dashboard "active campaigns" is total campaigns, "delivery rate" counts only `DELIVERED` (never set) → always 0%.
- **Data model:** one `SendLog.status` enum mixes delivery state with engagement (`OPENED` overwrites `BOUNCED`); `customFields`/`metadata` double-encoded throughout, with `typeof === "string"` patches in 8 places; `CampaignMember` actually models *list* membership; `testEmails` is a CSV string.
- **Missing workflow link:** there is no UI or import option to put contacts into a list, yet campaigns can only target lists.
- **Duplication:** merge-field parsing/rendering implemented twice (server `template-renderer.ts`, client `template-utils.ts`) with the same bug in both; two design-token systems (`tokens.css` vs `tailwind.config.ts`); field-alias tables duplicated client/server.
- **Production path:** Express does not serve `dist/client`; `CLIENT_URL` (the Vite dev URL) is used as the public base for links in emails.

---

## 4. Feature audit

| Feature | Verdict | Rationale |
|---|---|---|
| Stack (Express, Prisma, Postgres, React, TanStack Query, Tailwind, Zod) | **Keep** | Appropriate for a single-tenant internal tool; the problems are implementation, not stack. |
| Contacts CRUD, search, pagination | **Improve** | Works server-side; client data layer broken. |
| CSV import + mapping | **Refactor** | Move parsing fully server-side (multer + csv-parse); import *into a list*; explicit duplicate policy (skip / fill empty fields / overwrite) instead of silent overwrite; flag suppressed addresses. |
| XLSX import | **Add (Phase 1)** | Product pillar; currently advertised but non-functional. |
| Contact lists | **Improve** | Add "add selected to list" and list detail; rename `CampaignMember` → `ListMembership` (DB table name kept via `@@map`). |
| Templates + merge fields + fallbacks | **Refactor** | One shared renderer in `src/shared`, correct validation, HTML-escaping, unknown-field warnings. |
| Template versions | **Replace** | Counter without history → campaigns snapshot the rendered template at approval. |
| Recipient preview | **Refactor** | Server-side, per-recipient, honest missing-field detection; blocks approval when required fields are missing unless explicitly excluded. |
| Campaign lifecycle + approval | **Replace** | Approval snapshots template + recipient set + content hash; any later edit revokes approval; approver is an authenticated user. |
| Sending engine | **Replace** | Durable DB outbox, atomic claims, idempotent attempts, enforced limits, crash recovery (§5.2). |
| Test sends | **Replace** | "Send test" renders real recipients' content but delivers only to listed internal addresses; it never touches campaign recipients. |
| Suppression list | **Keep/Improve** | Model is sound; check at claim time; audit changes. |
| Unsubscribe | **Replace** | Signed tokens, RFC 8058 one-click `List-Unsubscribe-Post`, confirm-page GET. |
| Send logs + CSV export | **Improve** | Per-recipient attempts and errors visible on a campaign detail page. |
| SpaceMail webhooks | **Remove** | Unverified provider capability; replaced by IMAP. |
| Bounce & reply detection | **Add (Phase 4)** | IMAP polling of the SpaceMail mailbox (DSN parsing, `In-Reply-To` matching on our own Message-IDs). |
| Open/click tracking | **Remove (for now)** | Open data is unreliable (Apple MPP), click wrapping created an open redirect, and both were 404ing. Revisit with signed URLs once core is stable. |
| Enrichment | **Remove placeholders; defer** | Keep the model. Later: manual entries with evidence/confidence/verification and a review-then-apply flow that never overwrites. |
| DB-stored SMTP settings, API-key generator | **Remove** | Misleading. SMTP stays in env; Settings shows read-only status, a connection test, and a test send. |
| Dashboard | **Improve** | Only truthful numbers; campaigns needing attention (pending approval, failed, unknown-outcome sends). |
| Audit log | **Improve** | Model exists, almost no writers. Record import, approval, send start/pause/cancel, suppression changes. |
| Authentication | **Add (Phase 2, before any real send)** | Required for a meaningful approval gate. |

---

## 5. Architectural decisions

### 5.1 Layering (server)
`routes/*` (HTTP + Zod parsing only) → `services/*` (business rules, transactions) → Prisma. Shared contracts and the merge engine live in `src/shared`. Invariants (status transitions, approval validity, send claiming) are enforced in services, and in the database where possible (unique constraints, conditional updates).

### 5.2 Sending engine
- **Approval creates the send plan:** in one transaction it snapshots template content, freezes the recipient set (one `Send` row per recipient, unique `(campaignId, contactId)`), renders and stores each message, records a content hash, approver, and time. Suppressed or invalid recipients are recorded as `SKIPPED` with a reason at this point.
- **Delivery states:** `PENDING → CLAIMED → SENT | FAILED_RETRYABLE | FAILED_PERMANENT | UNKNOWN`. Engagement (`repliedAt`, `bouncedAt`, `unsubscribedAt`) is stored separately as timestamps plus an append-only event table.
- **Atomic claim:** `UPDATE … SET status='CLAIMED', claimedAt=now() WHERE id IN (SELECT … FOR UPDATE SKIP LOCKED LIMIT n)`. Only one worker can ever hold a row.
- **Idempotency:** we generate the RFC 5322 `Message-ID` and store it *before* handing the message to SMTP. An SMTP rejection (4xx/5xx) is a known failure. A timeout or crash after `DATA` becomes `UNKNOWN` and is **never auto-retried**; the UI surfaces it for a human decision.
- **Recovery:** on boot, rows left `CLAIMED` become `UNKNOWN`; `SENDING` campaigns resume automatically.
- **Limits** are enforced by the worker against the `Send` table: per-second rate, rolling 24 h mailbox cap (global, not per campaign, because the cap belongs to the mailbox), and per-campaign cap.
- **Worker:** one in-process loop. No Redis or queue service. The DB is the queue, which is adequate for one mailbox's volume and keeps deployment to one process + Postgres.

### 5.3 Auth
Session-cookie login backed by a `User` table (argon2/bcrypt hashes, `httpOnly` + `SameSite=Lax` cookies, CSRF safe because the API only accepts JSON). No dev bypass. Approval records `user.id`.

### 5.4 Public links
A new `PUBLIC_URL` env var (the server's externally reachable origin) replaces `CLIENT_URL` for anything inside an email. Unsubscribe tokens are HMAC-signed with `APP_SECRET`.

### 5.5 Client
- `lib/api.ts` returns the unwrapped `data` and a typed error; per-resource hooks (`useContacts`, `useCampaign`, …) own query keys.
- Routes gain detail pages: `/contacts/lists/:id`, `/templates/:id`, `/campaigns/:id` (preview → test send → approve → send → live log). Modals are kept for small forms only.
- `npm run build` runs `tsc --noEmit` for client and server before bundling, so type errors fail the build.
- One token source: CSS variables in `tokens.css`, referenced by `tailwind.config.ts`.

### 5.6 Database migrations
- **Repair:** add `CREATE EXTENSION IF NOT EXISTS citext;` to the init migration and mark it applied with `prisma migrate resolve` (the live schema already matches it).
- **Changes** go in new migrations: `Send`/`SendEvent` replace `send_logs` (no production data exists — 0 rows); a `users` table; a unique constraint on sends; un-double-encode JSON with `UPDATE … SET custom_fields = (custom_fields #>> '{}')::jsonb WHERE jsonb_typeof(custom_fields) = 'string'`.
- Nothing is dropped while it holds data without an explicit migration step.

### 5.7 Testing
- Vitest unit tests: the shared merge engine; SMTP error classification.
- Worker tests with a fake transport, covering concurrent claims, crash-after-DATA → `UNKNOWN`, limit enforcement, and test mode never reaching real recipients.
- Route integration tests against a dedicated `fr_mailer_test` database.
- ESLint config added.

---

## 6. Phased plan

| Phase | Scope | Acceptance criteria |
|---|---|---|
| **0 — Safety & baseline** | `.gitignore` ✅; initial commit; repair migration; ESLint config; type-checked build; configurable port; SMTP optional at boot (sending disabled with a visible reason); Express serves `dist/client` in production. | `migrate status` clean; `npm run build` fails on type errors and passes after fixes; `npm start` serves the UI. |
| **1 — Data → template → preview** | Shared merge engine; server-side CSV/XLSX import into a list with duplicate policy; list membership UI; client data layer and crashing components fixed; template editor with live recipient preview. | A CSV with duplicates, invalid emails and blanks imports into a list with an accurate report; a two-field template saves; preview shows per-recipient missing fields; zero client type errors. |
| **2 — Auth, approval & sending** | Users + login; approval snapshot; outbox worker; test sends; limits; signed unsubscribe; audit log. | Tests prove: no duplicate send under concurrent start/resume; crash after `DATA` → `UNKNOWN`, not resent; test mode delivers only to test addresses; editing after approval revokes it; limits hold. Verified end-to-end against a local SMTP sink, never against real recipients. |
| **3 — Visibility** | Campaign detail page with live progress, per-recipient log, filters, CSV export; honest dashboard. | Every recipient's state and error is visible; `UNKNOWN` rows have a resolve action. |
| **4 — Follow-up** | IMAP poller for bounces (DSN) and replies, with auto-suppression of hard bounces. | Fixture DSNs/replies are matched to sends by Message-ID; hard bounces suppress the address. |
| **5 — Enrichment** | Manual enrichment with evidence, confidence, verification, and review-then-apply. | Applying never overwrites a non-empty field without explicit per-field confirmation. |

Deferred until the core passes its tests: open/click tracking, sequences, analytics, multiple providers, AI enrichment.

---

## 7. Prioritized findings & status (updated 2026-10-25)

Every "verified" item was checked against the running app (API calls plus a headless-Chrome run through all pages), not by reading code alone.

### P0 — critical

| # | Finding | Fix | Verified by | Status |
|---|---|---|---|---|
| 1 | Test mode with no test addresses mailed the whole list | Test mode never sends outside the test list; starting with none → 400 | API run: 1 recipient → `SKIPPED`, 0 SMTP connections | **Fixed** |
| 2 | Live sends possible with an unsafe engine and real SpaceMail credentials | `ALLOW_LIVE_SENDING=false` lock; non-test campaigns → 409 | API → `LIVE_SENDING_LOCKED` | **Fixed (interim)** |
| 3 | Duplicate sends: non-atomic start/resume/claim; post-SMTP DB errors re-sent on retry | Atomic `updateMany` transitions and claims; one loop per campaign; post-send write outside the catch | Two concurrent `/start` → one `started`, one `INVALID_STATUS`, 1 log row | **Fixed (interim)**; the durable outbox is Phase 2 |
| 4 | Pause or cancel overwritten as COMPLETED | Final status written only `WHERE status='SENDING'` | Code + type check | **Fixed** |
| 5 | No authentication (dev bypass; API key in the client bundle) | Session login, `requireAuth` on all `/api`, API-key path removed | Anonymous → 401; cookie `httpOnly`; employee approve → 403 | **Fixed** |
| 6 | Open redirect at `/webhooks/track/click`; tracking links 404 | Tracking removed (routes, pixel, link rewriting, wizard toggles) | Both routes → 404 | **Fixed** |
| 7 | Anyone could unsubscribe any address by POSTing an email | Email-only branch removed; IDs required | POST `{email}` → 400 | **Fixed** |
| 8 | Template preview iframe `allow-scripts allow-same-origin` | `sandbox=""` | Code | **Fixed** |
| 9 | SMTP password saved in plain text to the DB by a settings form that nothing used | Form and `PATCH` removed; read-only Mailbox view | Browser: config shown, password absent | **Fixed** |
| 10 | Every list in the UI empty (`res.data.data`) | Typed `ApiEnvelope<T>`; pages read `.data` / `.pagination` | Browser: Templates list shows 2 rows | **Fixed** |
| 11 | Runtime crashes: `Button`/`Badge`/`FileText`/`setEditingTemplate` undefined | Imports and props fixed; client type errors 98 → 0; `npm run build` now type-checks | `npm run build` passes | **Fixed** |
| 12 | Templates with two merge fields rejected | Nesting check `\{\{[^}]*\{\{`; test corrected | Unit tests + API create | **Fixed** |
| 13 | Init migration failed (`citext` missing) | Extension added, resolved, org migration deployed | `migrate status` clean | **Fixed** |
| 14 | Unsubscribe link in emails 404s, and isn't signed | Signed token + RFC 8058 one-click | — | **Open** (Phase 2; live sending stays locked until then) |

### P1 — broken primary workflows / major defects

| # | Finding | Plan | Status |
|---|---|---|---|
| 15 | CSV import always fails (`multer` not installed or mounted); XLSX advertised but unsupported | Server-side multer + csv-parse + XLSX; import into a list | Open (Phase 1) |
| 16 | No way to add contacts to a list from the UI | "Add to list" bulk action; import-into-list | Open (Phase 1) |
| 17 | Desktop sidebar never visible (translated off-screen) | `lg:static lg:translate-x-0`; real mobile drawer | **Fixed** (browser screenshot) |
| 18 | Dashboard showed invented trends (+12%…), "delivery rate" always 0, "active" = all campaigns | Fabricated numbers removed; true counts | **Fixed** |
| 19 | Dashboard quick actions did nothing (`onClick` on `Card`) | Real buttons | **Fixed** |
| 20 | Fake API-key tab (Regenerate did nothing; it crashed on open) | Removed with the API-key auth | **Fixed** |
| 21 | No campaign detail page: preview shows raw HTML text, no per-recipient log, Retry calls a non-existent route | `/campaigns/:id` with preview → test → approve → send → log | Open (Phase 3) |
| 22 | Preview misses missing fields (`in` check always true) | Shared merge engine with honest missing-field detection | Open (Phase 1) |
| 23 | Merge values injected into HTML unescaped | HTML-escape in the shared renderer | Open (Phase 1) |
| 24 | Approval doesn't lock content or recipients | Approval snapshot + content hash | Open (Phase 2) |
| 25 | `customFields` double-encoded as a JSON string | Data migration + stop `JSON.stringify` into JSONB | Open (Phase 1) |
| 26 | Rate, daily and campaign limits not enforced | Enforced by the worker | Open (Phase 2) |
| 27 | SpaceMail webhook built on an unverified premise; signature over re-serialised JSON | Remove; IMAP poller | Open (Phase 4) |

### P2 — UX, maintainability, testing

- Deletes have no confirmation (campaigns, templates, contacts, suppressions). Use `ConfirmDialog` everywhere destructive.
- Header title duplicates each page's `<h1>`; Settings tabs have no visible active state.
- Campaign wizard: no per-step validation; the step indicator overflows on narrow screens.
- Two token systems (`tokens.css` vs `tailwind.config.ts`). Consolidate on CSS variables.
- Error handler logs a full stack trace for expected 4xx responses (noise; possible PII in logs).
- No ESLint config; stale compiled `src/shared/types.js` / `.d.ts` beside the sources.
- No route-level integration tests; the sending worker needs fake-transport tests (Phase 2).

### P3 — polish

- Dev-only React Query Devtools bubble overlaps content in screenshots.
- The Settings "General" tab content is static; fold it into Mailbox or remove it.
