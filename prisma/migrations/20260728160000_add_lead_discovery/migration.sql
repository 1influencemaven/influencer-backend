-- AlterEnum
CREATE TYPE "LeadDiscoveryStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- AlterEnum
CREATE TYPE "LeadStatus" AS ENUM ('UNDER_REVIEW', 'APPROVED', 'DISCARDED', 'DUPLICATE');

-- AlterEnum
CREATE TYPE "LeadEmailConfidence" AS ENUM ('VALID', 'PROBABLE', 'DOUBTFUL', 'INVALID', 'UNKNOWN');

-- CreateTable
CREATE TABLE "LeadDiscoveryRun" (
    "id" TEXT NOT NULL,
    "brandCandidateId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "status" "LeadDiscoveryStatus" NOT NULL DEFAULT 'PROCESSING',
    "providerId" TEXT NOT NULL,
    "providerOptions" JSONB NOT NULL,
    "limit" INTEGER NOT NULL DEFAULT 10,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDiscoveryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "brandCandidateId" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "contactName" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT NOT NULL,
    "emailConfidence" "LeadEmailConfidence" NOT NULL DEFAULT 'UNKNOWN',
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "profileUrl" TEXT,
    "providerId" TEXT NOT NULL,
    "sourceOptionId" TEXT,
    "fitReason" TEXT,
    "source" TEXT NOT NULL,
    "status" "LeadStatus" NOT NULL DEFAULT 'UNDER_REVIEW',
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadDiscoveryRun_brandCandidateId_idx" ON "LeadDiscoveryRun"("brandCandidateId");

-- CreateIndex
CREATE INDEX "LeadDiscoveryRun_influencerId_idx" ON "LeadDiscoveryRun"("influencerId");

-- CreateIndex
CREATE INDEX "LeadDiscoveryRun_status_idx" ON "LeadDiscoveryRun"("status");

-- CreateIndex
CREATE INDEX "LeadDiscoveryRun_createdAt_idx" ON "LeadDiscoveryRun"("createdAt");

-- CreateIndex
CREATE INDEX "Lead_brandCandidateId_idx" ON "Lead"("brandCandidateId");

-- CreateIndex
CREATE INDEX "Lead_influencerId_idx" ON "Lead"("influencerId");

-- CreateIndex
CREATE INDEX "Lead_runId_idx" ON "Lead"("runId");

-- CreateIndex
CREATE INDEX "Lead_status_idx" ON "Lead"("status");

-- CreateIndex
CREATE INDEX "Lead_email_idx" ON "Lead"("email");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- AddForeignKey
ALTER TABLE "LeadDiscoveryRun" ADD CONSTRAINT "LeadDiscoveryRun_brandCandidateId_fkey" FOREIGN KEY ("brandCandidateId") REFERENCES "BrandCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadDiscoveryRun" ADD CONSTRAINT "LeadDiscoveryRun_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_brandCandidateId_fkey" FOREIGN KEY ("brandCandidateId") REFERENCES "BrandCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Lead" ADD CONSTRAINT "Lead_runId_fkey" FOREIGN KEY ("runId") REFERENCES "LeadDiscoveryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
