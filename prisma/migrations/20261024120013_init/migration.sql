-- Required for case-insensitive email columns (was missing; the migration failed without it)
CREATE EXTENSION IF NOT EXISTS citext;

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'SENDING', 'PAUSED', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "SendStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'BOUNCED', 'COMPLAINED', 'UNSUBSCRIBED', 'FAILED', 'SUPPRESSED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "SuppressionReason" AS ENUM ('HARD_BOUNCE', 'SOFT_BOUNCE', 'SPAM_COMPLAINT', 'UNSUBSCRIBE', 'MANUAL', 'INVALID_EMAIL', 'DOMAIN_SUPPRESSION');

-- CreateEnum
CREATE TYPE "EnrichmentStatus" AS ENUM ('GUESSED', 'VERIFIED', 'MANUAL', 'REJECTED');

-- CreateTable
CREATE TABLE "contacts" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "company" TEXT,
    "title" TEXT,
    "phone" TEXT,
    "customFields" JSONB NOT NULL DEFAULT '{}',
    "source" TEXT,
    "importedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contact_lists" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "contact_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_members" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "contactListId" TEXT NOT NULL,
    "addedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overrides" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "campaign_members_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "templates" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaigns" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "templateId" TEXT NOT NULL,
    "contactListId" TEXT NOT NULL,
    "fromName" TEXT NOT NULL,
    "fromEmail" TEXT NOT NULL,
    "replyTo" TEXT,
    "rateLimit" INTEGER NOT NULL DEFAULT 10,
    "dailyLimit" INTEGER NOT NULL DEFAULT 1000,
    "campaignLimit" INTEGER NOT NULL DEFAULT 10000,
    "testMode" BOOLEAN NOT NULL DEFAULT true,
    "testEmails" TEXT NOT NULL DEFAULT '',
    "trackOpens" BOOLEAN NOT NULL DEFAULT true,
    "trackClicks" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,
    "approvedAt" TIMESTAMPTZ,
    "approvedBy" TEXT,
    "startedAt" TIMESTAMPTZ,
    "completedAt" TIMESTAMPTZ,

    CONSTRAINT "campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "send_logs" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "SendStatus" NOT NULL DEFAULT 'PENDING',
    "messageId" TEXT,
    "error" TEXT,
    "openedAt" TIMESTAMPTZ,
    "clickedAt" TIMESTAMPTZ,
    "repliedAt" TIMESTAMPTZ,
    "bouncedAt" TIMESTAMPTZ,
    "unsubscribedAt" TIMESTAMPTZ,
    "attempt" INTEGER NOT NULL DEFAULT 1,
    "lastAttemptAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "send_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "suppression_entries" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "reason" "SuppressionReason" NOT NULL,
    "source" TEXT NOT NULL,
    "campaignId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ,

    CONSTRAINT "suppression_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "enrichments" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "field" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" "EnrichmentStatus" NOT NULL DEFAULT 'GUESSED',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "verifiedAt" TIMESTAMPTZ,
    "verifiedBy" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "enrichments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityId" TEXT,
    "entityType" TEXT,
    "userId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "contacts_email_key" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_email_idx" ON "contacts"("email");

-- CreateIndex
CREATE INDEX "contacts_company_idx" ON "contacts"("company");

-- CreateIndex
CREATE UNIQUE INDEX "contact_lists_name_key" ON "contact_lists"("name");

-- CreateIndex
CREATE INDEX "campaign_members_contactListId_idx" ON "campaign_members"("contactListId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_members_contactId_contactListId_key" ON "campaign_members"("contactId", "contactListId");

-- CreateIndex
CREATE UNIQUE INDEX "templates_name_key" ON "templates"("name");

-- CreateIndex
CREATE UNIQUE INDEX "campaigns_name_key" ON "campaigns"("name");

-- CreateIndex
CREATE INDEX "campaigns_status_idx" ON "campaigns"("status");

-- CreateIndex
CREATE INDEX "campaigns_contactListId_idx" ON "campaigns"("contactListId");

-- CreateIndex
CREATE INDEX "send_logs_campaignId_status_idx" ON "send_logs"("campaignId", "status");

-- CreateIndex
CREATE INDEX "send_logs_contactId_idx" ON "send_logs"("contactId");

-- CreateIndex
CREATE INDEX "send_logs_messageId_idx" ON "send_logs"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "suppression_entries_email_key" ON "suppression_entries"("email");

-- CreateIndex
CREATE INDEX "suppression_entries_email_idx" ON "suppression_entries"("email");

-- CreateIndex
CREATE INDEX "suppression_entries_reason_idx" ON "suppression_entries"("reason");

-- CreateIndex
CREATE INDEX "enrichments_contactId_field_idx" ON "enrichments"("contactId", "field");

-- CreateIndex
CREATE INDEX "enrichments_source_idx" ON "enrichments"("source");

-- CreateIndex
CREATE INDEX "audit_logs_entityType_entityId_idx" ON "audit_logs"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "audit_logs_action_idx" ON "audit_logs"("action");

-- CreateIndex
CREATE INDEX "audit_logs_createdAt_idx" ON "audit_logs"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "settings_key_key" ON "settings"("key");

-- AddForeignKey
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_members" ADD CONSTRAINT "campaign_members_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "contact_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaigns" ADD CONSTRAINT "campaigns_contactListId_fkey" FOREIGN KEY ("contactListId") REFERENCES "contact_lists"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "send_logs" ADD CONSTRAINT "send_logs_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "enrichments" ADD CONSTRAINT "enrichments_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
