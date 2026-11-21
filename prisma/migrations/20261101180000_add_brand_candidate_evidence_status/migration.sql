-- CreateEnum: Nest evidence classifier persistence (AI-004.5.5)
CREATE TYPE "EvidenceStatus" AS ENUM ('VERIFIED', 'UNVERIFIED', 'NOT_ASSESSED');

-- AlterTable: additive column; DEFAULT backfills all historical rows as NOT_ASSESSED.
-- Do NOT infer VERIFIED from existing evidenceUrls.
ALTER TABLE "BrandCandidate" ADD COLUMN "evidenceStatus" "EvidenceStatus" NOT NULL DEFAULT 'NOT_ASSESSED';
