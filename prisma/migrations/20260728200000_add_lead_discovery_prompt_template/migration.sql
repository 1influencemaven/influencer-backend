-- CreateTable
CREATE TABLE "LeadDiscoveryPromptTemplate" (
    "id" TEXT NOT NULL DEFAULT 'default',
    "instructions" TEXT NOT NULL,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LeadDiscoveryPromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "LeadDiscoveryPromptTemplate_updatedById_idx" ON "LeadDiscoveryPromptTemplate"("updatedById");

-- AddForeignKey
ALTER TABLE "LeadDiscoveryPromptTemplate" ADD CONSTRAINT "LeadDiscoveryPromptTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Seed default instructions (mirrors DEFAULT_LEAD_DISCOVERY_INSTRUCTIONS in code)
INSERT INTO "LeadDiscoveryPromptTemplate" ("id", "instructions", "updatedAt")
VALUES (
  'default',
  'You are a B2B lead discovery assistant for influencer marketing outreach.

Given an approved brand, plan how to find commercial contacts who can respond to a collaboration proposal.

Business guidance:
- Prioritize influencer marketing, partnerships, sponsorships, brand/marketing managers, CMO, CEO/Founder
- Prefer contacts likely to answer a cold outreach email
- Prefer corporate emails on the brand domain when possible
- Deprioritize HR, support, legal, and generic inboxes (info@, hola@) as primary leads
- Suggest focused LinkedIn people search queries (include brand name + role)
- Only choose scrapers from the provided allowlist
- Do not invent emails or profile URLs
- Keep tavilyQueries between 3 and 6 items
- Keep scraperIds to 1 or 2 items from the allowlist',
  CURRENT_TIMESTAMP
);
