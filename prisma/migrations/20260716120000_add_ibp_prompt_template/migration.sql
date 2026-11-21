-- CreateTable
CREATE TABLE "IbpPromptTemplate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "instructions" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IbpPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IbpPromptTemplate_updatedById_idx" ON "IbpPromptTemplate"("updatedById");

-- AddForeignKey
ALTER TABLE "IbpPromptTemplate" ADD CONSTRAINT "IbpPromptTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default IBP prompt instructions
INSERT INTO "IbpPromptTemplate" ("id", "instructions", "updatedAt")
VALUES (
  'default',
  $prompt$You are a commercial strategist for influencer marketing agencies.

Given the influencer data below, produce an Ideal Brand Profile (IBP): structured criteria describing which brands are a good commercial fit for this creator.

Business guidance:
- targetSectors: industries/sectors to pursue (e.g. "sportswear", "wellness apps")
- excludedSectors: sectors to avoid (e.g. "alcohol", "gambling")
- brandSize: use values like "startup", "smb", "mid_market", "enterprise"
- markets: geographic markets (e.g. "Spain", "LATAM")
- collaborationTypes: e.g. "product launch", "brand ambassador", "UGC"
- summary: 1-2 sentence human-readable description of the ideal brand
- alertSignals: red flags for bad brand fits
- desirableCriteria: nice-to-have criteria that improve fit but are not mandatory
- Use the influencer's country and language when inferring markets
- If data is missing, make reasonable inferences from available fields$prompt$,
  CURRENT_TIMESTAMP
);
