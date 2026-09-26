-- Multi-file file shares.
--
-- A `file` share used to own exactly one file through the `File` table (1:1)
-- and kept the stored path on `Share.fileUrl`. It now owns 1–10 files through
-- `ShareFile` (1:n), each with its own stored path, so one route can hold a
-- whole set of files — and be downloaded as a ZIP or file by file.

-- CreateTable
CREATE TABLE "ShareFile" (
    "id" TEXT NOT NULL,
    "shareId" TEXT NOT NULL,
    "storedPath" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ShareFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ShareFile_shareId_position_idx" ON "ShareFile"("shareId", "position");

-- AddForeignKey
ALTER TABLE "ShareFile" ADD CONSTRAINT "ShareFile_shareId_fkey"
    FOREIGN KEY ("shareId") REFERENCES "Share"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Carry existing single-file shares over: the Share row held the stored path,
-- the File row held the display metadata.
INSERT INTO "ShareFile" ("id", "shareId", "storedPath", "fileName", "fileSize", "mimeType", "position")
SELECT f."id", f."shareId", s."fileUrl", f."fileName", f."fileSize", f."mimeType", 0
FROM "File" f
JOIN "Share" s ON s."id" = f."shareId"
WHERE s."fileUrl" IS NOT NULL;

-- The old one-file-per-share shape is gone.
DROP TABLE "File";
ALTER TABLE "Share" DROP COLUMN "fileUrl";
