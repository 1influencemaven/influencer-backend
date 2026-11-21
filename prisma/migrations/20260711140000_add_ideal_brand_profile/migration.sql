-- CreateEnum
CREATE TYPE "IbpStatus" AS ENUM ('DRAFT', 'PROCESSING', 'ACTIVE', 'FAILED');

-- CreateTable
CREATE TABLE "IdealBrandProfile" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "status" "IbpStatus" NOT NULL DEFAULT 'DRAFT',
    "targetSectors" TEXT[],
    "excludedSectors" TEXT[],
    "brandSize" TEXT[],
    "markets" TEXT[],
    "collaborationTypes" TEXT[],
    "summary" TEXT NOT NULL DEFAULT '',
    "alertSignals" TEXT[],
    "desirableCriteria" TEXT[],
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IdealBrandProfile_pkey" PRIMARY KEY ("id")
);

-- DropIndex
DROP INDEX IF EXISTS "Influencer_profileStatus_idx";

-- AlterTable
ALTER TABLE "Influencer" DROP COLUMN IF EXISTS "commercialProfile",
DROP COLUMN IF EXISTS "profileStatus";

-- DropEnum
DROP TYPE IF EXISTS "ProfileStatus";

-- CreateIndex
CREATE UNIQUE INDEX "IdealBrandProfile_influencerId_key" ON "IdealBrandProfile"("influencerId");

-- CreateIndex
CREATE INDEX "IdealBrandProfile_status_idx" ON "IdealBrandProfile"("status");

-- AddForeignKey
ALTER TABLE "IdealBrandProfile" ADD CONSTRAINT "IdealBrandProfile_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
