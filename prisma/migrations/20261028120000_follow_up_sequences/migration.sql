-- CreateEnum
CREATE TYPE "CampaignAutomationMode" AS ENUM ('MANUAL', 'APPROVAL_REQUIRED', 'AUTOMATIC');

-- CreateEnum
CREATE TYPE "RecipientSequenceState" AS ENUM ('PENDING_INITIAL', 'INITIAL_SENT', 'FOLLOW_UP_SCHEDULED', 'AWAITING_APPROVAL', 'FOLLOW_UP_SENT', 'REPLY_RECEIVED', 'BOUNCED', 'SUPPRESSED', 'PAUSED', 'COMPLETED', 'CANCELLED');

-- DropIndex
DROP INDEX IF EXISTS "sends_campaignId_email_key";

-- AlterTable
ALTER TABLE "campaign_recipient_overrides" ADD COLUMN IF NOT EXISTS "isCustom" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN     "automationMode" "CampaignAutomationMode" NOT NULL DEFAULT 'APPROVAL_REQUIRED';

-- AlterTable
ALTER TABLE "sends" ADD COLUMN     "approvedAt" TIMESTAMPTZ,
ADD COLUMN     "inReplyToId" TEXT,
ADD COLUMN     "isCustom" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "scheduledFor" TIMESTAMPTZ,
ADD COLUMN     "stepIndex" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "campaign_sequence_steps" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "stepIndex" INTEGER NOT NULL,
    "purpose" TEXT NOT NULL,
    "delayDays" INTEGER NOT NULL DEFAULT 3,
    "delayBusinessDaysOnly" BOOLEAN NOT NULL DEFAULT true,
    "subjectMode" TEXT NOT NULL DEFAULT 'THREADED',
    "customSubject" TEXT,
    "templateId" TEXT NOT NULL,
    "promptInstructions" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaign_sequence_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipient_states" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "email" CITEXT NOT NULL,
    "state" "RecipientSequenceState" NOT NULL DEFAULT 'PENDING_INITIAL',
    "currentStepIndex" INTEGER NOT NULL DEFAULT 0,
    "nextActionAt" TIMESTAMPTZ,
    "nextStepIndex" INTEGER,
    "pausedReason" TEXT,
    "cancelledReason" TEXT,
    "lastSentAt" TIMESTAMPTZ,
    "lastMessageId" TEXT,
    "repliedAt" TIMESTAMPTZ,
    "bouncedAt" TIMESTAMPTZ,
    "unsubscribedAt" TIMESTAMPTZ,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaign_recipient_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_sequence_steps_campaignId_idx" ON "campaign_sequence_steps"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_sequence_steps_campaignId_stepIndex_key" ON "campaign_sequence_steps"("campaignId", "stepIndex");

-- CreateIndex
CREATE INDEX "campaign_recipient_states_campaignId_state_idx" ON "campaign_recipient_states"("campaignId", "state");

-- CreateIndex
CREATE INDEX "campaign_recipient_states_nextActionAt_idx" ON "campaign_recipient_states"("nextActionAt");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipient_states_campaignId_email_key" ON "campaign_recipient_states"("campaignId", "email");

-- CreateIndex
CREATE INDEX "sends_campaignId_stepIndex_status_idx" ON "sends"("campaignId", "stepIndex", "status");

-- CreateIndex
CREATE INDEX "sends_status_scheduledFor_idx" ON "sends"("status", "scheduledFor");

-- CreateIndex
CREATE UNIQUE INDEX "sends_campaignId_email_stepIndex_key" ON "sends"("campaignId", "email", "stepIndex");

-- AddForeignKey
ALTER TABLE "campaign_sequence_steps" ADD CONSTRAINT "campaign_sequence_steps_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_sequence_steps" ADD CONSTRAINT "campaign_sequence_steps_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient_states" ADD CONSTRAINT "campaign_recipient_states_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient_states" ADD CONSTRAINT "campaign_recipient_states_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
