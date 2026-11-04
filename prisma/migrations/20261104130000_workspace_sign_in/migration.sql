-- Sign-in through the Focus Realm Workspace (hub mode). See docs/AUTH.md.
-- employeeCode links an account to its Workspace login; email becomes optional because
-- Workspace mailboxes can be shared. used_hub_tickets makes each launch ticket single-use.

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "employeeCode" TEXT,
ALTER COLUMN "email" DROP NOT NULL;

-- CreateTable
CREATE TABLE "used_hub_tickets" (
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ NOT NULL,
    "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "used_hub_tickets_pkey" PRIMARY KEY ("tokenHash")
);

-- CreateIndex
CREATE INDEX "used_hub_tickets_expiresAt_idx" ON "used_hub_tickets"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "users_employeeCode_key" ON "users"("employeeCode");

