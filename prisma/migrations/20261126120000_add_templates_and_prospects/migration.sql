-- CreateEnum
CREATE TYPE "EmailTemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProspectSource" AS ENUM ('LEAD', 'BRAND_CONTACT', 'AGENCY_CONTACT', 'CSV', 'MANUAL', 'SALESHANDY');

-- CreateEnum
CREATE TYPE "ProspectContactKind" AS ENUM ('PERSON', 'MAILBOX');

-- CreateEnum
CREATE TYPE "ProspectStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ProspectSyncStatus" AS ENUM ('LOCAL_ONLY', 'SYNCING', 'SYNCED', 'SYNC_FAILED');

-- CreateEnum
CREATE TYPE "ProspectSyncJobType" AS ENUM ('CSV_IMPORT', 'SALESHANDY_PUSH');

-- CreateEnum
CREATE TYPE "ProspectSyncJobStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailTemplate" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "preHeader" TEXT,
    "bodyHtml" TEXT NOT NULL,
    "bodyText" TEXT NOT NULL,
    "influencerVariables" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "validationIssues" INTEGER NOT NULL DEFAULT 0,
    "status" "EmailTemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EmailTemplateField" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "variableKey" TEXT NOT NULL,
    "locations" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EmailTemplateField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Prospect" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailNormalized" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "jobTitle" TEXT,
    "company" TEXT,
    "companyDomain" TEXT,
    "website" TEXT,
    "linkedInUrl" TEXT,
    "country" TEXT,
    "phoneNumber" TEXT,
    "contactKind" "ProspectContactKind" NOT NULL DEFAULT 'PERSON',
    "isGeneric" BOOLEAN NOT NULL DEFAULT false,
    "mailboxLabel" TEXT,
    "commercialRelevance" "CommercialRelevance" NOT NULL DEFAULT 'UNKNOWN',
    "source" "ProspectSource" NOT NULL,
    "brandCandidateId" TEXT,
    "brandBusinessContactId" TEXT,
    "leadId" TEXT,
    "agencyId" TEXT,
    "agencyContactId" TEXT,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProspectStatus" NOT NULL DEFAULT 'ACTIVE',
    "saleshandyProspectId" TEXT,
    "syncStatus" "ProspectSyncStatus" NOT NULL DEFAULT 'LOCAL_ONLY',
    "lastSyncedAt" TIMESTAMP(3),
    "lastSyncError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Prospect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectFieldValue" (
    "id" TEXT NOT NULL,
    "prospectId" TEXT NOT NULL,
    "customFieldId" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectFieldValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProspectSyncJob" (
    "id" TEXT NOT NULL,
    "influencerId" TEXT,
    "type" "ProspectSyncJobType" NOT NULL,
    "status" "ProspectSyncJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "requestId" TEXT,
    "conflictAction" TEXT,
    "totalCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "errorSummary" JSONB,
    "reportUrl" TEXT,
    "errorMessage" TEXT,
    "initiatedById" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProspectSyncJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "EmailTemplate_influencerId_status_idx" ON "EmailTemplate"("influencerId", "status");

-- CreateIndex
CREATE INDEX "EmailTemplate_updatedAt_idx" ON "EmailTemplate"("updatedAt");

-- CreateIndex
CREATE INDEX "EmailTemplateField_customFieldId_idx" ON "EmailTemplateField"("customFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "EmailTemplateField_templateId_customFieldId_key" ON "EmailTemplateField"("templateId", "customFieldId");

-- CreateIndex
CREATE INDEX "Prospect_influencerId_status_idx" ON "Prospect"("influencerId", "status");

-- CreateIndex
CREATE INDEX "Prospect_source_idx" ON "Prospect"("source");

-- CreateIndex
CREATE INDEX "Prospect_brandCandidateId_idx" ON "Prospect"("brandCandidateId");

-- CreateIndex
CREATE INDEX "Prospect_leadId_idx" ON "Prospect"("leadId");

-- CreateIndex
CREATE INDEX "Prospect_brandBusinessContactId_idx" ON "Prospect"("brandBusinessContactId");

-- CreateIndex
CREATE INDEX "Prospect_agencyContactId_idx" ON "Prospect"("agencyContactId");

-- CreateIndex
CREATE UNIQUE INDEX "Prospect_influencerId_emailNormalized_key" ON "Prospect"("influencerId", "emailNormalized");

-- CreateIndex
CREATE INDEX "ProspectFieldValue_customFieldId_idx" ON "ProspectFieldValue"("customFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectFieldValue_prospectId_customFieldId_key" ON "ProspectFieldValue"("prospectId", "customFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "ProspectSyncJob_requestId_key" ON "ProspectSyncJob"("requestId");

-- CreateIndex
CREATE INDEX "ProspectSyncJob_influencerId_createdAt_idx" ON "ProspectSyncJob"("influencerId", "createdAt");

-- CreateIndex
CREATE INDEX "ProspectSyncJob_status_idx" ON "ProspectSyncJob"("status");

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplate" ADD CONSTRAINT "EmailTemplate_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateField" ADD CONSTRAINT "EmailTemplateField_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "EmailTemplate"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EmailTemplateField" ADD CONSTRAINT "EmailTemplateField_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_brandCandidateId_fkey" FOREIGN KEY ("brandCandidateId") REFERENCES "BrandCandidate"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_brandBusinessContactId_fkey" FOREIGN KEY ("brandBusinessContactId") REFERENCES "BrandBusinessContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_agencyContactId_fkey" FOREIGN KEY ("agencyContactId") REFERENCES "AgencyContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Prospect" ADD CONSTRAINT "Prospect_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectFieldValue" ADD CONSTRAINT "ProspectFieldValue_prospectId_fkey" FOREIGN KEY ("prospectId") REFERENCES "Prospect"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectFieldValue" ADD CONSTRAINT "ProspectFieldValue_customFieldId_fkey" FOREIGN KEY ("customFieldId") REFERENCES "CustomField"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectSyncJob" ADD CONSTRAINT "ProspectSyncJob_influencerId_fkey" FOREIGN KEY ("influencerId") REFERENCES "Influencer"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProspectSyncJob" ADD CONSTRAINT "ProspectSyncJob_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

