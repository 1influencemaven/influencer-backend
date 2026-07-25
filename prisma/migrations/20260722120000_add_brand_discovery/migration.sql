-- CreateEnum
CREATE TYPE "BrandDiscoveryStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "BrandCandidateStatus" AS ENUM ('UNDER_REVIEW', 'APPROVED', 'REJECTED', 'POSTPONED');

-- CreateTable
CREATE TABLE "BrandDiscoveryRun" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "status" "BrandDiscoveryStatus" NOT NULL DEFAULT 'PROCESSING',
    "source" TEXT NOT NULL,
    "limit" INTEGER NOT NULL DEFAULT 20,
    "ibpSnapshot" JSONB NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrandCandidate" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "discoveryRunId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "website" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "sector" TEXT,
    "market" TEXT,
    "brandSize" TEXT,
    "score" DOUBLE PRECISION,
    "fitReason" TEXT,
    "source" TEXT NOT NULL,
    "evidenceUrls" TEXT[],
    "status" "BrandCandidateStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandCandidate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandDiscoveryRun_influencerId_idx" ON "BrandDiscoveryRun"("influencerId");

-- CreateIndex
CREATE INDEX "BrandDiscoveryRun_status_idx" ON "BrandDiscoveryRun"("status");

-- CreateIndex
CREATE INDEX "BrandDiscoveryRun_createdAt_idx" ON "BrandDiscoveryRun"("createdAt");

-- CreateIndex
CREATE INDEX "BrandCandidate_influencerId_idx" ON "BrandCandidate"("influencerId");

-- CreateIndex
CREATE INDEX "BrandCandidate_discoveryRunId_idx" ON "BrandCandidate"("discoveryRunId");

-- CreateIndex
CREATE INDEX "BrandCandidate_status_idx" ON "BrandCandidate"("status");

-- CreateIndex
CREATE INDEX "BrandCandidate_domain_idx" ON "BrandCandidate"("domain");

-- CreateIndex
CREATE INDEX "BrandCandidate_createdAt_idx" ON "BrandCandidate"("createdAt");

-- AddForeignKey
ALTER TABLE "BrandDiscoveryRun" ADD CONSTRAINT "BrandDiscoveryRun_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandCandidate" ADD CONSTRAINT "BrandCandidate_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BrandCandidate" ADD CONSTRAINT "BrandCandidate_discoveryRunId_fkey" FOREIGN KEY ("discoveryRunId") REFERENCES "BrandDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
