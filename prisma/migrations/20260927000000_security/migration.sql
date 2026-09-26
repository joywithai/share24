-- Security hardening (phase 2).
--
-- Two tables back the guards: `SecurityEvent` is the audit trail (rate limit
-- hits, wrong PINs, blocked requests, suspicious uploads) and `BlockedIp` is
-- the deny list the guard consults before running an action.

-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('rate_limit', 'pin_failure', 'blocked_ip', 'suspicious_upload', 'login_failure', 'forbidden', 'maintenance');

-- CreateTable
CREATE TABLE "SecurityEvent" (
    "id" TEXT NOT NULL,
    "type" "SecurityEventType" NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'warning',
    "ip" TEXT,
    "route" TEXT,
    "userId" TEXT,
    "userAgent" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SecurityEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SecurityEvent_createdAt_idx" ON "SecurityEvent"("createdAt");
CREATE INDEX "SecurityEvent_type_createdAt_idx" ON "SecurityEvent"("type", "createdAt");
CREATE INDEX "SecurityEvent_ip_createdAt_idx" ON "SecurityEvent"("ip", "createdAt");

-- CreateTable
CREATE TABLE "BlockedIp" (
    "id" TEXT NOT NULL,
    "ip" TEXT NOT NULL,
    "reason" TEXT,
    "blockedBy" TEXT,
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BlockedIp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BlockedIp_ip_key" ON "BlockedIp"("ip");
CREATE INDEX "BlockedIp_expiresAt_idx" ON "BlockedIp"("expiresAt");
