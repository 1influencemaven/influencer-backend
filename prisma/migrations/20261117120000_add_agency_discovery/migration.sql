-- Track 2C.1 — Agency Discovery domain (Agency + InfluencerAgency).
-- Do not conflate with BrandCandidate / BrandBusinessContact.

-- CreateEnum
CREATE TYPE "AgencyType" AS ENUM (
  'INFLUENCER_MARKETING_AGENCY',
  'TALENT_REPRESENTATION',
  'MARKETPLACE',
  'GENERAL_MARKETING',
  'DIRECTORY',
  'OTHER'
);

-- CreateEnum
CREATE TYPE "AgencyRelevanceStatus" AS ENUM (
  'UNDER_REVIEW',
  'RELEVANT',
  'NOT_RELEVANT',
  'DISCARDED'
);

-- CreateTable
CREATE TABLE "Agency" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "website" TEXT,
    "domain" TEXT NOT NULL,
    "country" TEXT,
    "description" TEXT,
    "agencyType" "AgencyType" NOT NULL DEFAULT 'OTHER',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Agency_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerAgency" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "agencyId" TEXT NOT NULL,
    "relevanceStatus" "AgencyRelevanceStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "relevanceExplanation" TEXT,
    "niches" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "searchMetadata" JSONB,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerAgency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Agency_domain_key" ON "Agency"("domain");

-- CreateIndex
CREATE INDEX "Agency_normalizedName_idx" ON "Agency"("normalizedName");

-- CreateIndex
CREATE INDEX "Agency_agencyType_idx" ON "Agency"("agencyType");

-- CreateIndex
CREATE INDEX "Agency_createdAt_idx" ON "Agency"("createdAt");

-- CreateIndex
CREATE INDEX "InfluencerAgency_influencerId_idx" ON "InfluencerAgency"("influencerId");

-- CreateIndex
CREATE INDEX "InfluencerAgency_agencyId_idx" ON "InfluencerAgency"("agencyId");

-- CreateIndex
CREATE INDEX "InfluencerAgency_relevanceStatus_idx" ON "InfluencerAgency"("relevanceStatus");

-- CreateIndex
CREATE INDEX "InfluencerAgency_discoveredAt_idx" ON "InfluencerAgency"("discoveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerAgency_influencerId_agencyId_key" ON "InfluencerAgency"("influencerId", "agencyId");

-- AddForeignKey
ALTER TABLE "InfluencerAgency" ADD CONSTRAINT "InfluencerAgency_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerAgency" ADD CONSTRAINT "InfluencerAgency_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE;
