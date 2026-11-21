-- CreateEnum
CREATE TYPE "ProfileStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Influencer" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instagram" TEXT,
    "tiktok" TEXT,
    "youtube" TEXT,
    "country" TEXT,
    "language" TEXT,
    "niche" TEXT,
    "subNiche" TEXT,
    "followers" INTEGER,
    "engagement" DECIMAL(5,2),
    "email" TEXT,
    "mediaKitUrl" TEXT,
    "profileStatus" "ProfileStatus" NOT NULL DEFAULT 'PENDING',
    "commercialProfile" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Influencer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Influencer_profileStatus_idx" ON "Influencer"("profileStatus");

-- CreateIndex
CREATE INDEX "Influencer_country_idx" ON "Influencer"("country");

-- CreateIndex
CREATE INDEX "Influencer_niche_idx" ON "Influencer"("niche");

-- CreateIndex
CREATE INDEX "Influencer_createdAt_idx" ON "Influencer"("createdAt");
