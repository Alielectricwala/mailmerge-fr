# FocusRealm Mail Merge — Functional Verification Report

**Date:** October 26, 2026  
**Application:** FocusRealm Mail Merge (`D:\Projects\FR - Mailer`)  
**Environment:** Node.js v24.14.0, PostgreSQL 16 (Local), Vite 5, Express 4, SpaceMail SMTP (`mail.spacemail.com:465`)  
**Status:** All Automated & Live Verification Checks **PASSED (100%)**

---

## 1. Executive Summary

This report documents the verification, hardening, and testing of the FocusRealm Mail Merge outreach engine. In accordance with project requirements, the system was verified end-to-end without rebuilding existing infrastructure. 

Key outcomes:
- **107 Automated Tests Passing (0 Failures):** 85 unit tests + 22 integration tests passing cleanly.
- **Strict Safe Sending Enforced:** Test sending is guarded by a strict allowlist restricted to explicitly permitted test recipients (`s265.frank@gmail.com`, `aves7203@gmail.com`), rejecting all unapproved addresses with `TEST_RECIPIENT_NOT_ALLOWED`.
- **Live SMTP Delivery Observed:** SpaceMail SMTP connection verified and live test emails successfully queued with server confirmation responses (`250 2.0.0 Ok`).
- **Deterministic Multi-Template Selection Verified:** Priority rules, verification gating (`requiresVerified`), manual overrides, and fallbacks operate deterministically with full human-readable audit explanations.
- **Immutability of Approved Campaigns:** Template assignments and rendered content are frozen at approval; post-approval edits to templates cannot alter queued or sent emails.
- **Accurate Analytics Attribution:** Event and send models capture `campaignId`, `recipientId`, `hotelSegment`, `contactPersona`, `templateId`, `templateVersion`, and `assignmentReason`, calculating rates against documented denominators (`providerAcceptedCount`).
- **Deployment Roadmap Provided:** Ready for immediate Vercel deployment with local DB tunnel, with clear migration path to Supabase PostgreSQL + Cloudflare R2 object storage.

---

## 2. Test Execution & Build Results

### 2.1 Automated Test Suites

```
Unit Tests (vitest run):
  ✓ src/shared/merge.test.ts (12 tests)
  ✓ src/server/services/inbox-classifier.test.ts (5 tests)
  ✓ src/server/services/smtp-outcome.test.ts (5 tests)
  ✓ src/shared/auth.test.ts (6 tests)
  ✓ src/server/services/classification.test.ts (5 tests)
  ✓ src/server/services/template-selection.test.ts (6 tests)
  ✓ src/shared/template-writer.test.ts (5 tests)
  ✓ src/server/services/email-cells.test.ts (8 tests)
  ✓ src/server/services/template-ai.test.ts (4 tests)
  ✓ src/server/middleware/session.test.ts (7 tests)
  ✓ src/server/services/contact-import.test.ts (18 tests)
  ✓ src/server/services/auth-service.test.ts (4 tests)
  Total: 85 passed | 0 failed | 12 test files

Integration Tests (tests/run-integration.mjs):
  ✓ src/server/services/verification.int.test.ts (5 tests)
  ✓ src/server/services/campaign-flow.int.test.ts (16 tests)
  ✓ src/server/services/multi-template-flow.int.test.ts (1 test)
  Total: 22 passed | 0 failed | 3 test files

Combined Total: 107 passed | 0 failed
```

### 2.2 Compilation & Build Checks

- **Server Typecheck (`tsc -p tsconfig.server.json --noEmit`):** Clean (0 errors).
- **Client Typecheck (`tsc -p tsconfig.client.json --noEmit`):** Clean (0 errors).
- **Client Production Bundle (`vite build`):** Clean build (2067 modules transformed into `dist/client/`).
- **Server Production Build (`tsc -p tsconfig.server.json`):** Output generated into `dist/server/`.

---

## 3. Step-by-Step Functional Verification

### Step 1 — Inspection of Architecture & Entry Points

- **Prisma Schema:** Models verified: `Campaign`, `Template`, `CampaignTemplate`, `CampaignRule`, `RecipientOverride`, `Contact`, `ContactList`, `ListMembership`, `Send`, `SendEvent`, `SuppressionEntry`, `AuditLog`.
- **Database Migrations:** Applied safely through `20261026091457_hotel_segments_and_multi_template` without data loss or table truncation on development database.
- **Entry Points Identified & Reused:**
  - Import: `src/server/services/contact-import.ts`
  - Classification: `src/server/services/classification.ts`
  - Template Selection: `src/server/services/template-selection.ts`
  - Merge Personalization: `src/shared/merge.ts`
  - Review & Approval: `src/server/services/campaign-service.ts` (`buildReview`, `approveCampaign`)
  - Safe Test Sending: `src/server/services/campaign-service.ts` (`sendTest`)
  - Analytics Attribution: `src/server/services/analytics-service.ts` (`getCampaignAnalytics`)

---

### Step 2 — Import & Classification Verification

#### Synthetic Fixtures Created
- [`tests/fixtures/synthetic-hotels-contacts.csv`](file:///d:/Projects/FR%20-%20Mailer/tests/fixtures/synthetic-hotels-contacts.csv):
  - **Hotel Segments:** Luxury, Boutique, Upscale, Midscale, Resort, Independent, Unknown.
  - **Contact Personas:** General Managers, Owner-Operators, Operations Directors, Revenue Managers, Unknown.
  - **Edge & Failure Cases:** Missing contact names (`ops.team@coastalretreat.test`), missing email rows, invalid email formatting (`not-an-email`), exact duplicate records (`aaditya.mehta@oberoihotels.test` repeated).
- [`tests/fixtures/co-market-partnerships.csv`](file:///d:/Projects/FR%20-%20Mailer/tests/fixtures/co-market-partnerships.csv):
  - Partnership fixtures for HTI India, Webvi, Shaw Hotels & Consultancy Services, plus test allowlist recipients.

#### Verified Behaviors
1. **Field Mapping & Validation:** Auto-mapping accurately maps `Email`, `Company`, `Job Title`, `Hotel Segment`, and `Contact Persona`.
2. **Duplicate Handling:** Duplicate detection obeys policy (`skip` / `fill_empty` / `overwrite`). Verified duplicate count reported accurately.
3. **Validation Errors:** Invalid rows without valid emails are rejected with descriptive errors (`Invalid email format: row 10`) without halting the import of valid rows.
4. **Classification Status & Confidence:**
   - Inferred classifications from title/company are stamped with `GUESSED` and realistic confidence scores (`< 1.0`).
   - Manual or explicit spreadsheet imports receive `MANUAL` status with confidence `1.0`.
   - Low-confidence classifications remain explicitly identifiable as uncertain and are never treated as verified facts.

---

### Step 3 — Multiple-Template Selection Verification

#### Test Campaign Configuration
- **4 Distinct Templates:**
  1. `tLuxuryGM`: Personalized pilot proposal for Luxury General Managers.
  2. `tOps`: SOP compliance and frontline verification for Operations Directors.
  3. `tOwner`: Brand equity and asset quality for Owner-Operators.
  4. `tFallback`: General hospitality leadership introduction.
- **Campaign Priority Rules:**
  - Rule 1 (Priority 1): Matches `LUXURY` + `GENERAL_MANAGER` with `requiresVerified: true`.
  - Rule 2 (Priority 2): Matches `OPERATIONS_DIRECTOR`.
  - Rule 3 (Priority 3): Matches `OWNER_OPERATOR`.
- **Manual Recipient Override:**
  - Contact `cFallbackUser` pinned to `tOwner` with reason `"VIP override requested by founder"`.

#### Verified Behaviors
1. **Manual Override Priority:** Overrides take precedence over matching rules (`assignmentSource: "OVERRIDE"`).
2. **Deterministic Priority Matching:** Priority ordering is deterministic. When multiple rules match, Rule 1 is chosen over Rule 2.
3. **Verification Enforcement:** An unverified luxury GM (`status: "GUESSED"`, confidence `0.6`) fails Rule 1 (`requiresVerified: true`) and safely falls back to `tFallback`.
4. **Fallback Handling:** Contacts with unmatched personas/segments are assigned `tFallback` with `assignmentSource: "FALLBACK"`.
5. **Explainability:** Every recipient selection produces an explicit audit string (e.g., `Rule #1 (Luxury GMs (Verified only)): matched Segment 'LUXURY' [verified]...`).
6. **Immutability of Approved Sends:**
   - On campaign approval, `Send` rows are created with rendered subject, HTML, plain-text, `templateId`, `templateVersion`, and `assignmentReason`.
   - Modifying `Template.subject` or `Template.bodyHtml` post-approval has **zero** effect on the frozen `Send` records.

---

---

### Step 4 — Outreach & Partnership Writeups and Personalization

The project maintains standard, production-ready template copies for FocusRealm's hospitality outreach and co-marketing partnerships.

#### A. Mise Hotel Pilot & Hotel Advisory Board Outreach Writeup
Used for direct outreach to General Managers, Directors of Operations, and Hotel Owners/Operators:

```text
Subject: Ensuring frontline service execution at {{company|your hotel}}

Dear {{firstName|{{company|Hospitality Team}}}},

I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.

One of the key challenges in hospitality is ensuring that SOPs, training, and service standards defined at the corporate level are consistently followed by frontline teams across properties. Even when standards are clearly documented, ensuring that tasks are executed correctly, verified, and recorded can be difficult across multiple teams and locations.

Mise Hotel, our hospitality-focused Service Execution Platform, is designed to address this challenge by bringing SOPs, training, and operational workflows together in a mobile-first platform. It helps translate documented standards into assigned tasks, supports teams in executing them, and captures evidence of completion to improve operational visibility and accountability.

As we continue developing Mise Hotel, we would welcome the opportunity to explore a pilot with {{company|your team}} to demonstrate the platform, understand your operational requirements, and gather feedback from your team.

We are also bringing together experienced hospitality leaders for the FocusRealm Hotel Advisory Board, where industry experts can help shape Mise Hotel around the real-world needs of hotel operations, workforce training, and service delivery. Given {{company|your organization}}’s experience in the hospitality industry, we would be honoured to explore your potential involvement.

Would {{#if firstName}}you{{else}}your team{{/if}} be available for a 20-minute meeting with Sehej to discuss Mise Hotel, a potential pilot, and the advisory opportunity? We would be happy to coordinate a time that suits your schedule.

Thank you for your time. We look forward to the opportunity to connect.

Best wishes,
Sachin Annadurai
Founder’s Office
FocusRealm
https://misehotel.com/
https://focusrealm.org/
```

#### B. Co-Marketing & Partnership Outreach Writeup
Used for hospitality platforms, consultants, LMS providers, and agencies:

**Spreadsheet Schema Expected:**
- `Company`: Target organization name
- `What it does`: Description of existing services / platforms
- `Partnership opportunity`: Synergistic value proposition

*Example Rows:*
- **HTI India:** What it does: *"HTI provides customized training for hospitality staff, including in-person and brand-specific programs."* | Partnership opportunity: *"HTI teaches employees how to perform (LMS); FocusRealm verifies frontline service execution (LTS)"*
- **Webvi:** What it does: *"Hospitality-specific recruitment and job-placement platform serving hotels, resorts, restaurants."* | Partnership opportunity: *"Hospitality Recruitment agency; FocusRealm helps maintain quality"*
- **Shaw Hotels & Consultancy Services:** What it does: *"Offers hospitality consulting, training, service-quality audits, mystery shopping, and SOP manuals."* | Partnership opportunity: *"Shaw audits identify gaps; FocusRealm tracks corrective actions and verifies completion"*

**Template Format:**
```text
Subject: Co-market partnership opportunity: {{company}} & FocusRealm

Dear {{firstName|{{company}} Team}},

I’m reaching out on behalf of Sehej Sharma, Founder & CEO of FocusRealm.

One of the key challenges in hospitality is ensuring that SOPs, training, and service standards defined at the corporate level are consistently followed by frontline teams across properties. Even when standards are clearly documented, ensuring that tasks are executed correctly, verified, and recorded can be difficult across multiple teams and locations.

Mise Hotel, our hospitality-focused Service Execution Platform, is designed to address this challenge by bringing SOPs, training, and operational workflows together in a mobile-first platform. It helps translate documented standards into assigned tasks, supports teams in executing them, and captures evidence of completion to improve operational visibility and accountability.

We have been closely following {{company}} and your work in hospitality: {{whatItDoes}}

We see a natural synergy: {{partnershipOpportunity}}.

As we continue developing Mise Hotel, we would welcome the opportunity to explore a pilot with {{company}} to demonstrate the platform, understand your operational requirements, and gather feedback from your team.

We are also bringing together experienced hospitality leaders for the FocusRealm Hotel Advisory Board, where industry experts can help shape Mise Hotel around the real-world needs of hotel operations, workforce training, and service delivery. Given {{company}}’s experience in the hospitality industry, we would be honoured to explore your potential involvement.

Would {{#if firstName}}you{{else}}your team{{/if}} be available for a 20-minute meeting with Sehej to discuss Mise Hotel, a potential pilot, and the advisory opportunity? We would be happy to coordinate a time that suits your schedule.

Thank you for your time. We look forward to the opportunity to connect.

Best wishes,
Sachin
Founder’s Office
FocusRealm
https://misehotel.com/
https://focusrealm.org/
```

### Step 5 — Safe SMTP Sending Verification

#### Multi-Layer Safeguards Enforced
1. **Strict Allowlist:** `PERMITTED_TEST_RECIPIENTS = ["s265.frank@gmail.com", "aves7203@gmail.com"]`.
   - Attempted test send to `unauthorized@outside.test` was **rejected** with `TEST_RECIPIENT_NOT_ALLOWED`.
2. **Zero-Send Connection Check:** `verifyMailbox()` verified SMTP authentication against `mail.spacemail.com:465` with TLS without sending an email.
3. **Dry-Run Mode:** `dryRun: true` evaluated 2 recipients, rendered full subject/HTML, and returned recipient counts with 0 dispatches to the transport layer.
4. **Duplicate Send Prevention:** Worker lease mechanism (`acquireLease`, `SendStatus.CLAIMED`) ensures concurrent workers or retries cannot double-send.
5. **Suppression Enforcement:** Active suppression table is checked prior to test sends and campaign dispatch.

#### Live SMTP Send Results
Live dispatches were executed strictly to the two permitted recipients via `src/server/scripts/run-full-verification.ts`:

- **Recipient 1:** `s265.frank@gmail.com`
  - Subject: `[Test] Ensuring frontline service execution at Mathur Hospitality`
  - **SMTP Response:** `250 2.0.0 Ok: queued as 4jCqWT1mHnz2x9D`
- **Recipient 2:** `aves7203@gmail.com`
  - Subject: `[Test] Ensuring frontline service execution at Northstar Hotels`
  - **SMTP Response:** `250 2.0.0 Ok: queued as 4jCqWT60c3z2x99`

*(No external or non-allowlisted emails were contacted. No credentials or secrets printed in logs or reports.)*

---

### Step 6 — Analytics Attribution & Metrics Integrity

#### Attribution Architecture
- The `Send` record links directly to:
  - `campaignId`
  - `contactId`
  - `hotelSegment` & `contactPersona`
  - `templateId` & `templateVersion`
  - `assignmentReason`
  - `status` (`SENT`, `FAILED`, `CANCELLED`, `UNKNOWN`)
- `recordSendOutcome`: Records manual or webhook-driven reply classifications (`POSITIVE`, `NEGATIVE`, `NEUTRAL`, `OUT_OF_OFFICE`) and `meetingBooked: true`.

#### Denominator Accuracy
Rates are computed in `src/server/services/analytics-service.ts` using strict, documented denominators:
- **Total Recipients:** Unique count of contacts targeted.
- **Provider Accepted Count (`SENT`):** Base denominator for conversion and bounce calculations.
- **Delivery Rate:** `providerAcceptedCount / totalRecipients`
- **Reply Rate:** `repliedCount / providerAcceptedCount`
- **Positive Reply Rate:** `positiveRepliesCount / providerAcceptedCount`
- **Meeting Booked Rate:** `meetingsBookedCount / providerAcceptedCount`
- **Bounce Rate:** `bouncedCount / providerAcceptedCount`

---

## 4. Categorized Verification Status

### Tests Passed
- All 85 unit tests (`npm run test`).
- All 22 integration tests (`npm run test:integration`).
- Full client and server build (`npm run build`).
- Live SMTP connection check against SpaceMail.
- Live test send to `s265.frank@gmail.com` (SMTP queued: `4jCqWT1mHnz2x9D`).
- Live test send to `aves7203@gmail.com` (SMTP queued: `4jCqWT60c3z2x99`).

### Tests Failed
- **None (0 failed).**

### Features Verified Locally
- CSV import with field mapping, validation error reporting, and duplicate skipping.
- Hotel segment and contact persona inference and confidence assignment.
- Multi-template priority selection, verification constraints, and manual overrides.
- Immutability of campaign review and approval snapshots.
- Merge-field personalization and fallback resolution.
- Aggregation of analytics attribution by template, segment, persona, and outcomes.

### Features Verified Against the SMTP Server
- SpaceMail SMTP TLS authentication on port 465.
- Test mode strict allowlist enforcement (rejection of unpermitted addresses).
- Dry-run mode preview without SMTP dispatch.
- Successful transmission and queueing of personalized outreach emails for both permitted test addresses.

### Features Not Yet Verified
- Inbound IMAP polling for automated reply/bounce classification (requires running background worker over live SpaceMail IMAP account over time).
- Webhook events from external calendar booking platforms for automated `meetingBooked` flagging.

### Remaining Blockers
- **None.** Core mail merge, personalization, multi-template campaign selection, safe sending, and analytics attribution are fully functional and tested.

---

## 5. Deployment Architecture & Cloud Migration Guide

### 5.1 Deploying to Vercel with Local Database (Immediate Step)

Vercel functions execute in a cloud serverless environment and cannot resolve `localhost:5432` without a network bridge. To deploy now with your local database:

1. **Start a Secure Tunnel to Local PostgreSQL:**
   ```powershell
   # Using cloudflared (recommended) or ngrok:
   cloudflared access tcp --hostname db.yourdomain.com --url localhost:5432
   # Or using bore / ngrok:
   ngrok tcp 5432
   ```
2. **Configure Vercel Environment Variables:**
   - In Vercel Project Dashboard → **Settings** → **Environment Variables**:
     - `DATABASE_URL`: `postgresql://postgres:postgres@<tunnel-host>:<tunnel-port>/fr_mailer`
     - `DIRECT_URL`: `postgresql://postgres:postgres@<tunnel-host>:<tunnel-port>/fr_mailer`
     - `APP_SECRET`: *(A random 32-character string)*
     - `PUBLIC_URL`: `https://your-project.vercel.app`
     - `ALLOWED_TEST_RECIPIENTS`: `s265.frank@gmail.com,aves7203@gmail.com`
     - `SMTP_HOST`: `mail.spacemail.com`
     - `SMTP_PORT`: `465`
     - `SMTP_SECURE`: `true`
     - `SMTP_USER`: `namaste@misehotel.com`
     - `SMTP_PASS`: *(Configured password)*
     - `SMTP_FROM_EMAIL`: `namaste@misehotel.com`
     - `SMTP_FROM_NAME`: `FocusRealm`
3. **Deploy via Vercel CLI or Git:**
   ```powershell
   npx vercel --prod
   ```

---

### 5.2 Migration Guide: Supabase PostgreSQL + Cloudflare R2

#### Step 1: Supabase Database Migration
1. Create a Supabase project at [supabase.com](https://supabase.com).
2. Go to **Project Settings** → **Database**:
   - Copy **Connection Pooling URL** (port `6543`, transaction mode):
     ```env
     DATABASE_URL="postgres://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true&connection_limit=1"
     ```
   - Copy **Direct Connection URL** (port `5432`):
     ```env
     DIRECT_URL="postgres://postgres.[PROJECT_REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"
     ```
3. Run migrations against Supabase:
   ```powershell
   npx prisma migrate deploy
   ```

#### Step 2: Cloudflare R2 for Large File Storage
For large XLSX contact files and campaign attachments:
1. Create an R2 bucket in Cloudflare Dashboard (e.g. `fr-mailer-storage`).
2. Generate R2 API tokens with Object Read & Write permissions.
3. Configure environment variables in Vercel:
   ```env
   R2_ACCOUNT_ID="your-cloudflare-account-id"
   R2_ACCESS_KEY_ID="your-access-key-id"
   R2_SECRET_ACCESS_KEY="your-secret-access-key"
   R2_BUCKET_NAME="fr-mailer-storage"
   R2_PUBLIC_URL="https://assets.focusrealm.org"
   ```
4. The existing import parser (`src/server/services/contact-import.ts`) already streams spreadsheets via buffer. In production, files > 10MB can be uploaded directly to R2 using pre-signed S3 URLs via `@aws-sdk/client-s3`.

---

## 6. Checklist of Remaining Manual Steps

- [ ] **Inspect Inboxes:** Check inboxes for `s265.frank@gmail.com` and `aves7203@gmail.com` to confirm email formatting and layout as received by the mail client.
- [ ] **Setup Local DB Tunnel or Supabase:** For Vercel deployment, configure the database tunnel or provision Supabase database credentials.
- [ ] **Set Vercel Environment Variables:** Add `DATABASE_URL`, `DIRECT_URL`, `APP_SECRET`, and SMTP credentials in Vercel Project Settings.
- [ ] **Provision Cloudflare R2:** Create bucket and API tokens in Cloudflare when ready to migrate large file storage.
- [ ] **Approve Production Campaigns:** Ensure that before any real outreach campaign is launched, human review and approval is confirmed via the `/campaigns/:id/review` panel.
