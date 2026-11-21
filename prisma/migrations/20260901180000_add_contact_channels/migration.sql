-- CreateEnum
CREATE TYPE "ContactChannelType" AS ENUM ('LINKEDIN', 'EMAIL', 'WEBSITE');

-- CreateEnum
CREATE TYPE "ContactChannelStatus" AS ENUM ('ACTIVE', 'INVALID');

-- CreateEnum
CREATE TYPE "ContactChannelSource" AS ENUM ('LINKEDIN_SCRAPER', 'PUBLIC_WEB', 'MANUAL', 'LEGACY_MIGRATION', 'BRAND_WEBSITE');

-- CreateTable
CREATE TABLE "ContactChannel" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "type" "ContactChannelType" NOT NULL,
    "value" TEXT NOT NULL,
    "valueNormalized" TEXT NOT NULL,
    "status" "ContactChannelStatus" NOT NULL DEFAULT 'ACTIVE',
    "source" "ContactChannelSource" NOT NULL,
    "sourceUrl" TEXT,
    "isGeneric" BOOLEAN,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContactChannel_pkey" PRIMARY KEY ("id")
);

-- Backfill EMAIL channels from legacy Lead.email
INSERT INTO "ContactChannel" (
    "id", "leadId", "type", "value", "valueNormalized", "status", "source",
    "isGeneric", "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    'EMAIL'::"ContactChannelType",
    "email",
    lower(trim("email")),
    'ACTIVE'::"ContactChannelStatus",
    'LEGACY_MIGRATION'::"ContactChannelSource",
    "isGeneric",
    NOW(),
    NOW()
FROM "Lead"
WHERE "email" IS NOT NULL AND trim("email") <> '';

-- Backfill LINKEDIN channels from legacy Lead.profileUrl
INSERT INTO "ContactChannel" (
    "id", "leadId", "type", "value", "valueNormalized", "status", "source",
    "createdAt", "updatedAt"
)
SELECT
    gen_random_uuid()::text,
    "id",
    'LINKEDIN'::"ContactChannelType",
    "profileUrl",
    lower(regexp_replace(split_part("profileUrl", '?', 1), '/+$', '')),
    'ACTIVE'::"ContactChannelStatus",
    'LEGACY_MIGRATION'::"ContactChannelSource",
    NOW(),
    NOW()
FROM "Lead"
WHERE "profileUrl" IS NOT NULL AND trim("profileUrl") <> '';

-- AlterTable: Lead.email nullable (ADR-0014)
ALTER TABLE "Lead" ALTER COLUMN "email" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "ContactChannel_leadId_idx" ON "ContactChannel"("leadId");

-- CreateIndex
CREATE INDEX "ContactChannel_type_idx" ON "ContactChannel"("type");

-- CreateIndex
CREATE UNIQUE INDEX "ContactChannel_leadId_type_valueNormalized_key" ON "ContactChannel"("leadId", "type", "valueNormalized");

-- AddForeignKey
ALTER TABLE "ContactChannel" ADD CONSTRAINT "ContactChannel_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;
