-- CreateEnum
CREATE TYPE "CommercialRelevance" AS ENUM ('HIGH', 'NEUTRAL', 'LOW', 'UNKNOWN');

-- AlterTable: historical ContactChannel rows default to UNKNOWN (safe; no speculative backfill)
ALTER TABLE "ContactChannel" ADD COLUMN "commercialRelevance" "CommercialRelevance" NOT NULL DEFAULT 'UNKNOWN';

-- CreateTable: BrandBusinessContact (ADR-0016) — company inbox without inventing a person Lead
CREATE TABLE "BrandBusinessContact" (
    "id" TEXT NOT NULL,
    "brandCandidateId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "label" TEXT,
    "isGeneric" BOOLEAN NOT NULL DEFAULT true,
    "commercialRelevance" "CommercialRelevance" NOT NULL DEFAULT 'UNKNOWN',
    "source" "ContactChannelSource" NOT NULL,
    "sourceUrl" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandBusinessContact_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandBusinessContact_brandCandidateId_idx" ON "BrandBusinessContact"("brandCandidateId");

-- CreateIndex
CREATE INDEX "BrandBusinessContact_emailNormalized_idx" ON "BrandBusinessContact"("emailNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "BrandBusinessContact_brandCandidateId_emailNormalized_key" ON "BrandBusinessContact"("brandCandidateId", "emailNormalized");

-- AddForeignKey
ALTER TABLE "BrandBusinessContact" ADD CONSTRAINT "BrandBusinessContact_brandCandidateId_fkey" FOREIGN KEY ("brandCandidateId") REFERENCES "BrandCandidate"("id") ON DELETE CASCADE ON UPDATE CASCADE;
