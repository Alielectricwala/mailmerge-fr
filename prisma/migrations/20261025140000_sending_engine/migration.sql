-- Sending engine rewrite: approval snapshots, per-recipient sends, events, import history.
-- Drops send_logs and per-campaign test/tracking/limit columns. Guarded: aborts if any of
-- that data exists, so it can never silently destroy history.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "send_logs") THEN
    RAISE EXCEPTION 'send_logs has rows; migrate them before applying this migration';
  END IF;
  IF EXISTS (SELECT 1 FROM "campaigns") THEN
    RAISE EXCEPTION 'campaigns has rows; this migration drops campaign columns';
  END IF;
  IF EXISTS (SELECT 1 FROM "campaign_members" WHERE "overrides" <> '{}'::jsonb) THEN
    RAISE EXCEPTION 'campaign_members.overrides has data';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "DeliveryStatus" AS ENUM ('PENDING', 'CLAIMED', 'SENT', 'FAILED', 'UNKNOWN', 'SKIPPED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SendEventType" AS ENUM ('HARD_BOUNCE', 'SOFT_BOUNCE', 'REPLY', 'UNSUBSCRIBE');

-- AlterEnum
BEGIN;
CREATE TYPE "CampaignStatus_new" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENDING', 'PAUSED', 'COMPLETED', 'CANCELLED');
ALTER TABLE "campaigns" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "campaigns" ALTER COLUMN "status" TYPE "CampaignStatus_new" USING ("status"::text::"CampaignStatus_new");
ALTER TYPE "CampaignStatus" RENAME TO "CampaignStatus_old";
ALTER TYPE "CampaignStatus_new" RENAME TO "CampaignStatus";
DROP TYPE "CampaignStatus_old";
ALTER TABLE "campaigns" ALTER COLUMN "status" SET DEFAULT 'DRAFT';
COMMIT;

-- DropForeignKey
ALTER TABLE "send_logs" DROP CONSTRAINT "send_logs_campaignId_fkey";

-- DropForeignKey
ALTER TABLE "send_logs" DROP CONSTRAINT "send_logs_contactId_fkey";

-- DropIndex
DROP INDEX "contacts_email_idx";

-- DropIndex
DROP INDEX "enrichments_source_idx";

-- DropIndex
DROP INDEX "suppression_entries_email_idx";

-- AlterTable
ALTER TABLE "campaign_members" DROP COLUMN "overrides";

-- AlterTable
ALTER TABLE "campaigns" DROP COLUMN "approvedBy",
DROP COLUMN "campaignLimit",
DROP COLUMN "dailyLimit",
DROP COLUMN "fromEmail",
DROP COLUMN "rateLimit",
DROP COLUMN "testEmails",
DROP COLUMN "testMode",
DROP COLUMN "trackClicks",
DROP COLUMN "trackOpens",
ADD COLUMN     "approvalRequestedAt" TIMESTAMPTZ,
ADD COLUMN     "bodyHtml" TEXT,
ADD COLUMN     "bodyText" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMPTZ,
ADD COLUMN     "contentHash" TEXT,
ADD COLUMN     "pausedReason" TEXT,
ADD COLUMN     "sendRatePerMinute" INTEGER NOT NULL DEFAULT 20,
ADD COLUMN     "subject" TEXT;

-- AlterTable
ALTER TABLE "enrichments" ADD COLUMN     "appliedAt" TIMESTAMPTZ,
ADD COLUMN     "createdById" TEXT;

-- DropTable
DROP TABLE "send_logs";

-- DropEnum
DROP TYPE "SendStatus";

-- CreateTable
CREATE TABLE "import_batches" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contactListId" TEXT,
    "createdById" TEXT,
    "duplicatePolicy" TEXT NOT NULL,
    "totalRows" INTEGER NOT NULL,
    "created" INTEGER NOT NULL,
    "updated" INTEGER NOT NULL,
    "unchanged" INTEGER NOT NULL,
    "skipped" INTEGER NOT NULL,
    "errors" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sends" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "email" CITEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "html" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "status" "DeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "messageId" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "claimedAt" TIMESTAMPTZ,
    "sentAt" TIMESTAMPTZ,
    "bouncedAt" TIMESTAMPTZ,
    "repliedAt" TIMESTAMPTZ,
    "unsubscribedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "sends_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_events" (
    "id" TEXT NOT NULL,
    "sendId" TEXT NOT NULL,
    "type" "SendEventType" NOT NULL,
    "occurredAt" TIMESTAMPTZ NOT NULL,
    "detail" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "import_batches_createdAt_idx" ON "import_batches"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "sends_messageId_key" ON "sends"("messageId");

-- CreateIndex
CREATE INDEX "sends_campaignId_status_idx" ON "sends"("campaignId", "status");

-- CreateIndex
CREATE INDEX "sends_status_sentAt_idx" ON "sends"("status", "sentAt");

-- CreateIndex
CREATE INDEX "sends_contactId_idx" ON "sends"("contactId");

-- CreateIndex
CREATE UNIQUE INDEX "sends_campaignId_email_key" ON "sends"("campaignId", "email");

-- CreateIndex
CREATE INDEX "send_events_sendId_idx" ON "send_events"("sendId");

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "contact_lists"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sends" ADD CONSTRAINT "sends_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sends" ADD CONSTRAINT "sends_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_events" ADD CONSTRAINT "send_events_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "sends"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Repair JSON double-encoding: values were stored as a JSON *string* containing JSON
UPDATE "contacts" SET "customFields" = ("customFields" #>> '{}')::jsonb WHERE jsonb_typeof("customFields") = 'string';
UPDATE "enrichments" SET "evidence" = ("evidence" #>> '{}')::jsonb WHERE jsonb_typeof("evidence") = 'string';
UPDATE "suppression_entries" SET "metadata" = ("metadata" #>> '{}')::jsonb WHERE jsonb_typeof("metadata") = 'string';
UPDATE "audit_logs" SET "metadata" = ("metadata" #>> '{}')::jsonb WHERE jsonb_typeof("metadata") = 'string';
