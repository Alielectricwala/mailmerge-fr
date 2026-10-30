-- AlterTable
ALTER TABLE "contacts" ADD COLUMN     "contactPersona" TEXT,
ADD COLUMN     "contactPersonaConfidence" DOUBLE PRECISION,
ADD COLUMN     "contactPersonaStatus" "EnrichmentStatus",
ADD COLUMN     "hotelSegment" TEXT,
ADD COLUMN     "hotelSegmentConfidence" DOUBLE PRECISION,
ADD COLUMN     "hotelSegmentStatus" "EnrichmentStatus";

-- AlterTable
ALTER TABLE "sends" ADD COLUMN     "assignmentReason" TEXT,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "templateVersion" INTEGER;

-- CreateTable
CREATE TABLE "campaign_templates" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "isFallback" BOOLEAN NOT NULL DEFAULT false,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaign_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_rules" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "hotelSegment" TEXT,
    "contactPersona" TEXT,
    "requiresVerified" BOOLEAN NOT NULL DEFAULT false,
    "minConfidence" DOUBLE PRECISION,
    "city" TEXT,
    "description" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaign_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "campaign_recipient_overrides" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "campaign_recipient_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "campaign_templates_campaignId_idx" ON "campaign_templates"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_templates_campaignId_templateId_key" ON "campaign_templates"("campaignId", "templateId");

-- CreateIndex
CREATE INDEX "campaign_rules_campaignId_priority_idx" ON "campaign_rules"("campaignId", "priority");

-- CreateIndex
CREATE INDEX "campaign_recipient_overrides_campaignId_idx" ON "campaign_recipient_overrides"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "campaign_recipient_overrides_campaignId_contactId_key" ON "campaign_recipient_overrides"("campaignId", "contactId");

-- CreateIndex
CREATE INDEX "contacts_hotelSegment_idx" ON "contacts"("hotelSegment");

-- CreateIndex
CREATE INDEX "contacts_contactPersona_idx" ON "contacts"("contactPersona");

-- AddForeignKey
ALTER TABLE "sends" ADD CONSTRAINT "sends_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "campaign_templates_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_templates" ADD CONSTRAINT "campaign_templates_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_rules" ADD CONSTRAINT "campaign_rules_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_rules" ADD CONSTRAINT "campaign_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient_overrides" ADD CONSTRAINT "campaign_recipient_overrides_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient_overrides" ADD CONSTRAINT "campaign_recipient_overrides_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "campaign_recipient_overrides" ADD CONSTRAINT "campaign_recipient_overrides_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
