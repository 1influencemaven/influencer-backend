-- CreateEnum
CREATE TYPE "EmailAccountJobType" AS ENUM ('CONNECT', 'RECONNECT');

-- CreateEnum
CREATE TYPE "EmailAccountJobStatus" AS ENUM ('PROCESSING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "EmailAccountJob" (
    "id" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "EmailAccountJobType" NOT NULL,
    "status" "EmailAccountJobStatus" NOT NULL DEFAULT 'PROCESSING',
    "accountCount" INTEGER NOT NULL,
    "targets" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reportUrl" TEXT,
    "errorMessage" TEXT,
    "initiatedById" TEXT,
    "lastCheckedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "EmailAccountJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EmailAccountJob_requestId_key" ON "EmailAccountJob"("requestId");

-- CreateIndex
CREATE INDEX "EmailAccountJob_status_idx" ON "EmailAccountJob"("status");

-- CreateIndex
CREATE INDEX "EmailAccountJob_createdAt_idx" ON "EmailAccountJob"("createdAt");

-- AddForeignKey
ALTER TABLE "EmailAccountJob" ADD CONSTRAINT "EmailAccountJob_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
