-- Storage providers + runtime settings.
--
-- V1 wrote every uploaded file to the local disk. Files can now live either on
-- the local disk (`LOCAL`, the default) or in a Cloudflare R2 bucket (`R2`),
-- and each row remembers which one owns its bytes — so switching the app to R2
-- never orphans the shares that were already uploaded.
--
-- `SystemSetting` is a small key/value table for values an admin may change at
-- runtime (maintenance mode, retention windows, …).

-- CreateEnum
CREATE TYPE "StorageType" AS ENUM ('LOCAL', 'R2');

-- AlterTable
-- Existing rows are local by default, which is exactly where their bytes are.
ALTER TABLE "ShareFile" ADD COLUMN "storageType" "StorageType" NOT NULL DEFAULT 'LOCAL',
ADD COLUMN "r2Key" TEXT,
ADD COLUMN "r2Bucket" TEXT;

-- CreateTable
CREATE TABLE "SystemSetting" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SystemSetting_key_key" ON "SystemSetting"("key");
