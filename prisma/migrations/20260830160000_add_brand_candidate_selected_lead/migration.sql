-- AlterTable
ALTER TABLE "BrandCandidate" ADD COLUMN "selectedLeadId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "BrandCandidate_selectedLeadId_key" ON "BrandCandidate"("selectedLeadId");

-- AddForeignKey
ALTER TABLE "BrandCandidate" ADD CONSTRAINT "BrandCandidate_selectedLeadId_fkey" FOREIGN KEY ("selectedLeadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;