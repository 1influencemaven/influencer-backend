-- CreateEnum
CREATE TYPE "CustomFieldType" AS ENUM ('TEXT', 'NUMBER', 'DATE', 'LONG_TEXT', 'DROPDOWN', 'CURRENCY');

-- CreateEnum
CREATE TYPE "CustomFieldOrigin" AS ENUM ('SYSTEM', 'CUSTOM');

-- CreateEnum
CREATE TYPE "CustomFieldDisabledReason" AS ENUM ('MANUAL', 'REMOVED_IN_SALESHANDY');

-- CreateEnum
CREATE TYPE "CustomFieldSyncStatus" AS ENUM ('COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "CustomFieldSyncTrigger" AS ENUM ('MANUAL', 'BOOTSTRAP', 'AFTER_WRITE');

-- CreateTable
CREATE TABLE "CustomField" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "fieldType" "CustomFieldType" NOT NULL,
    "origin" "CustomFieldOrigin" NOT NULL DEFAULT 'CUSTOM',
    "fallbackText" TEXT,
    "saleshandyFieldId" TEXT,
    "systemMapping" TEXT,
    "metadata" JSONB,
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "disabledReason" "CustomFieldDisabledReason",
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomField_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CustomFieldSyncRun" (
    "id" TEXT NOT NULL,
    "status" "CustomFieldSyncStatus" NOT NULL,
    "trigger" "CustomFieldSyncTrigger" NOT NULL,
    "remoteCount" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "unchangedCount" INTEGER NOT NULL DEFAULT 0,
    "deactivatedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "initiatedById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "CustomFieldSyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_key_key" ON "CustomField"("key");

-- CreateIndex
CREATE UNIQUE INDEX "CustomField_saleshandyFieldId_key" ON "CustomField"("saleshandyFieldId");

-- CreateIndex
CREATE INDEX "CustomField_origin_isActive_idx" ON "CustomField"("origin", "isActive");

-- CreateIndex
CREATE INDEX "CustomField_fieldType_idx" ON "CustomField"("fieldType");

-- CreateIndex
CREATE INDEX "CustomFieldSyncRun_startedAt_idx" ON "CustomFieldSyncRun"("startedAt");

-- AddForeignKey
ALTER TABLE "CustomFieldSyncRun" ADD CONSTRAINT "CustomFieldSyncRun_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

