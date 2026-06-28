-- AlterTable
ALTER TABLE "User" ADD COLUMN "name" TEXT NOT NULL DEFAULT '';

-- Remove default after backfill
ALTER TABLE "User" ALTER COLUMN "name" DROP DEFAULT;
