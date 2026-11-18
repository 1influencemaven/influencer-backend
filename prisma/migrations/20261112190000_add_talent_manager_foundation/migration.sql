-- CreateEnum
CREATE TYPE "InfluencerQuarter" AS ENUM ('Q1', 'Q2', 'Q3', 'Q4');

-- CreateEnum
CREATE TYPE "InfluencerDataOrigin" AS ENUM ('MANUAL', 'EXTERNAL', 'LEGACY');

-- AlterTable
ALTER TABLE "Influencer" ADD COLUMN     "instagramNormalized" TEXT,
ADD COLUMN     "managerId" TEXT,
ADD COLUMN     "niches" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "outgoingEmail" TEXT;

-- CreateTable
CREATE TABLE "InfluencerQuarterAssignment" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "quarter" "InfluencerQuarter" NOT NULL,
    "year" INTEGER NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InfluencerQuarterAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InfluencerFieldProvenance" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "fieldKey" TEXT NOT NULL,
    "origin" "InfluencerDataOrigin" NOT NULL,
    "source" TEXT,
    "fetchedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InfluencerFieldProvenance_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InfluencerQuarterAssignment_year_idx" ON "InfluencerQuarterAssignment"("year");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerQuarterAssignment_influencerId_year_quarter_key" ON "InfluencerQuarterAssignment"("influencerId", "year", "quarter");

-- CreateIndex
CREATE UNIQUE INDEX "InfluencerFieldProvenance_influencerId_fieldKey_key" ON "InfluencerFieldProvenance"("influencerId", "fieldKey");

-- CreateIndex
CREATE UNIQUE INDEX "Influencer_instagramNormalized_key" ON "Influencer"("instagramNormalized");

-- CreateIndex
CREATE INDEX "Influencer_managerId_idx" ON "Influencer"("managerId");

-- AddForeignKey
ALTER TABLE "Influencer" ADD CONSTRAINT "Influencer_managerId_fkey" FOREIGN KEY ("managerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerQuarterAssignment" ADD CONSTRAINT "InfluencerQuarterAssignment_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InfluencerFieldProvenance" ADD CONSTRAINT "InfluencerFieldProvenance_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
