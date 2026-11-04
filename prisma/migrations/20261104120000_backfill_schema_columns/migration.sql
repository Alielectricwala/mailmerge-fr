-- Columns that schema.prisma already declared but no earlier migration created.
-- IF NOT EXISTS: a database brought up with `prisma db push` may already have them.

-- AlterTable
ALTER TABLE "campaign_recipient_overrides" ADD COLUMN IF NOT EXISTS "customBodyHtml" TEXT,
ADD COLUMN IF NOT EXISTS "customBodyText" TEXT,
ADD COLUMN IF NOT EXISTS "customSubject" TEXT;

-- AlterTable
ALTER TABLE "campaigns" ADD COLUMN IF NOT EXISTS "fromEmail" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "senderName" TEXT,
ADD COLUMN IF NOT EXISTS "sendingEmail" TEXT;
