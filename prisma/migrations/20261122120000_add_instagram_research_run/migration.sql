-- CreateEnum
CREATE TYPE "InstagramResearchStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "InstagramResearchMode" AS ENUM ('USERNAME', 'INFLUENCER');

-- CreateTable
CREATE TABLE "InstagramResearchRun" (
    "id" TEXT NOT NULL,
    "status" "InstagramResearchStatus" NOT NULL DEFAULT 'PROCESSING',
    "mode" "InstagramResearchMode" NOT NULL,
    "username" TEXT,
    "handleNormalized" TEXT,
    "influencerId" TEXT,
    "result" JSONB,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InstagramResearchRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InstagramResearchRun_status_idx" ON "InstagramResearchRun"("status");

-- CreateIndex
CREATE INDEX "InstagramResearchRun_mode_idx" ON "InstagramResearchRun"("mode");

-- CreateIndex
CREATE INDEX "InstagramResearchRun_handleNormalized_idx" ON "InstagramResearchRun"("handleNormalized");

-- CreateIndex
CREATE INDEX "InstagramResearchRun_influencerId_idx" ON "InstagramResearchRun"("influencerId");

-- CreateIndex
CREATE INDEX "InstagramResearchRun_createdAt_idx" ON "InstagramResearchRun"("createdAt");

-- AddForeignKey
ALTER TABLE "InstagramResearchRun" ADD CONSTRAINT "InstagramResearchRun_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
