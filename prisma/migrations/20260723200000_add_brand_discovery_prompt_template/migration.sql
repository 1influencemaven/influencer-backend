-- CreateTable
CREATE TABLE "BrandDiscoveryPromptTemplate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "instructions" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrandDiscoveryPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BrandDiscoveryPromptTemplate_updatedById_idx" ON "BrandDiscoveryPromptTemplate"("updatedById");

-- AddForeignKey
ALTER TABLE "BrandDiscoveryPromptTemplate" ADD CONSTRAINT "BrandDiscoveryPromptTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default Brand Discovery prompt instructions
INSERT INTO "BrandDiscoveryPromptTemplate" ("id", "instructions", "updatedAt")
VALUES (
  'default',
  $prompt$You are a B2B brand discovery assistant for influencer marketing.

Given an Ideal Brand Profile (IBP) and web/search evidence, select brands that are a strong commercial fit for the influencer.

Business guidance:
- Prefer brands grounded in the provided evidence URLs
- Exclude sectors listed in excludedSectors
- Prefer brands with a real corporate website
- Score fit from 0–100 based on sector, market, brand size, and IBP criteria
- Explain fitReason briefly in business terms
- Do not invent emails, contacts, or brands without evidence
- Do not return more brands than the requested limit$prompt$,
  CURRENT_TIMESTAMP
);
