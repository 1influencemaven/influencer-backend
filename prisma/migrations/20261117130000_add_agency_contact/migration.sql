-- Track 2C.4.2 — Agency Contact Research domain (AgencyContact).
-- Depends on 20261117120000_add_agency_discovery (Agency table + enums).
-- Do not conflate with BrandBusinessContact / Lead / ContactChannel.

-- CreateEnum
CREATE TYPE "AgencyContactKind" AS ENUM (
  'MAILBOX',
  'PERSON'
);

-- CreateTable
CREATE TABLE "AgencyContact" (
    "id" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "label" TEXT,
    "displayName" TEXT,
    "title" TEXT,
    "contactKind" "AgencyContactKind" NOT NULL DEFAULT 'MAILBOX',
    "isGeneric" BOOLEAN NOT NULL DEFAULT true,
    "commercialRelevance" "CommercialRelevance" NOT NULL DEFAULT 'UNKNOWN',
    "metadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AgencyContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AgencyContact_agencyId_idx" ON "AgencyContact"("agencyId");

-- CreateIndex
CREATE INDEX "AgencyContact_emailNormalized_idx" ON "AgencyContact"("emailNormalized");

-- CreateIndex
CREATE INDEX "AgencyContact_commercialRelevance_idx" ON "AgencyContact"("commercialRelevance");

-- CreateIndex
CREATE INDEX "AgencyContact_contactKind_idx" ON "AgencyContact"("contactKind");

-- CreateIndex
CREATE INDEX "AgencyContact_discoveredAt_idx" ON "AgencyContact"("discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgencyContact_agencyId_emailNormalized_key" ON "AgencyContact"("agencyId", "emailNormalized");

-- AddForeignKey
ALTER TABLE "AgencyContact" ADD CONSTRAINT "AgencyContact_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
