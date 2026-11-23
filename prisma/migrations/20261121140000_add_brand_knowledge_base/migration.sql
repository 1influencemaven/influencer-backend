-- CreateEnum
CREATE TYPE "BrandKnowledgeStatus" AS ENUM ('ACTIVE', 'STALE', 'BLOCKED');

-- CreateTable
CREATE TABLE "Brand" (
    "id" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "sectors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "markets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sizeTag" TEXT,
    "evidenceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "BrandKnowledgeStatus" NOT NULL DEFAULT 'ACTIVE',
    "contactYield" JSONB,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastVerifiedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Brand_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandNicheAffinity" (
    "id" TEXT NOT NULL,
    "brandId" TEXT NOT NULL,
    "nicheKey" TEXT NOT NULL,
    "surfacedCount" INTEGER NOT NULL DEFAULT 0,
    "approvedCount" INTEGER NOT NULL DEFAULT 0,
    "rejectedCount" INTEGER NOT NULL DEFAULT 0,
    "postponedCount" INTEGER NOT NULL DEFAULT 0,
    "scoreSum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "scoredCount" INTEGER NOT NULL DEFAULT 0,
    "avgScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastScore" DOUBLE PRECISION,
    "collaborationTypes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastSurfacedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastDecisionAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandNicheAffinity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Brand_domain_key" ON "Brand"("domain");

-- CreateIndex
CREATE INDEX "Brand_status_lastVerifiedAt_idx" ON "Brand"("status", "lastVerifiedAt");

-- CreateIndex
CREATE INDEX "Brand_lastSeenAt_idx" ON "Brand"("lastSeenAt");

-- CreateIndex
CREATE INDEX "BrandNicheAffinity_nicheKey_avgScore_idx" ON "BrandNicheAffinity"("nicheKey", "avgScore" DESC);

-- CreateIndex
CREATE INDEX "BrandNicheAffinity_nicheKey_approvedCount_idx" ON "BrandNicheAffinity"("nicheKey", "approvedCount");

-- CreateIndex
CREATE INDEX "BrandNicheAffinity_nicheKey_lastSurfacedAt_idx" ON "BrandNicheAffinity"("nicheKey", "lastSurfacedAt");

-- CreateIndex
CREATE INDEX "BrandNicheAffinity_brandId_idx" ON "BrandNicheAffinity"("brandId");

-- CreateIndex
CREATE UNIQUE INDEX "BrandNicheAffinity_brandId_nicheKey_key" ON "BrandNicheAffinity"("brandId", "nicheKey");

-- CreateIndex
CREATE INDEX "BrandCandidate_influencerId_domain_idx" ON "BrandCandidate"("influencerId", "domain");

-- AddForeignKey
ALTER TABLE "BrandNicheAffinity" ADD CONSTRAINT "BrandNicheAffinity_brandId_fkey" FOREIGN KEY ("brandId") REFERENCES "Brand"("id") ON DELETE CASCADE ON UPDATE CASCADE;

