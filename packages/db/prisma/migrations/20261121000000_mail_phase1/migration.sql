-- CreateEnum
CREATE TYPE "MailAccountStatus" AS ENUM ('connected', 'disconnected', 'needs_reauth', 'error');

-- CreateTable
CREATE TABLE "MailAccount" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "googleAccountId" VARCHAR(128) NOT NULL,
    "email" VARCHAR(254) NOT NULL,
    "displayName" VARCHAR(256),
    "avatarUrl" VARCHAR(2048),
    "status" "MailAccountStatus" NOT NULL DEFAULT 'connected',
    "scopes" TEXT NOT NULL,
    "lastConnectedAt" TIMESTAMP(3),
    "lastSyncAt" TIMESTAMP(3),
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOAuthCredential" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mailAccountId" UUID NOT NULL,
    "encryptedAccessToken" TEXT NOT NULL,
    "encryptedRefreshToken" TEXT,
    "tokenType" VARCHAR(32) NOT NULL DEFAULT 'Bearer',
    "expiresAt" TIMESTAMP(3),
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailOAuthCredential_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAccountSetting" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "mailAccountId" UUID NOT NULL,
    "syncFrequencyMinutes" INTEGER NOT NULL DEFAULT 15,
    "notifyOnSyncError" BOOLEAN NOT NULL DEFAULT true,
    "syncEnabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MailAccountSetting_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailAuditEvent" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "mailAccountId" UUID,
    "eventType" VARCHAR(64) NOT NULL,
    "description" VARCHAR(512) NOT NULL,
    "metadata" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailAuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MailOAuthState" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "userId" UUID NOT NULL,
    "stateHash" VARCHAR(64) NOT NULL,
    "codeVerifier" VARCHAR(128) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "targetAccountId" UUID,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MailOAuthState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_userId_email_key" ON "MailAccount"("userId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccount_userId_googleAccountId_key" ON "MailAccount"("userId", "googleAccountId");

-- CreateIndex
CREATE INDEX "MailAccount_userId_idx" ON "MailAccount"("userId");

-- CreateIndex
CREATE INDEX "MailAccount_status_idx" ON "MailAccount"("status");

-- CreateIndex
CREATE UNIQUE INDEX "MailOAuthCredential_mailAccountId_key" ON "MailOAuthCredential"("mailAccountId");

-- CreateIndex
CREATE INDEX "MailOAuthCredential_mailAccountId_idx" ON "MailOAuthCredential"("mailAccountId");

-- CreateIndex
CREATE INDEX "MailOAuthCredential_expiresAt_idx" ON "MailOAuthCredential"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailAccountSetting_mailAccountId_key" ON "MailAccountSetting"("mailAccountId");

-- CreateIndex
CREATE INDEX "MailAccountSetting_mailAccountId_idx" ON "MailAccountSetting"("mailAccountId");

-- CreateIndex
CREATE INDEX "MailAuditEvent_userId_idx" ON "MailAuditEvent"("userId");

-- CreateIndex
CREATE INDEX "MailAuditEvent_mailAccountId_idx" ON "MailAuditEvent"("mailAccountId");

-- CreateIndex
CREATE INDEX "MailAuditEvent_createdAt_idx" ON "MailAuditEvent"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "MailOAuthState_stateHash_key" ON "MailOAuthState"("stateHash");

-- CreateIndex
CREATE INDEX "MailOAuthState_userId_idx" ON "MailOAuthState"("userId");

-- CreateIndex
CREATE INDEX "MailOAuthState_expiresAt_idx" ON "MailOAuthState"("expiresAt");

-- AddForeignKey
ALTER TABLE "MailAccount" ADD CONSTRAINT "MailAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailOAuthCredential" ADD CONSTRAINT "MailOAuthCredential_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAccountSetting" ADD CONSTRAINT "MailAccountSetting_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAuditEvent" ADD CONSTRAINT "MailAuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailAuditEvent" ADD CONSTRAINT "MailAuditEvent_mailAccountId_fkey" FOREIGN KEY ("mailAccountId") REFERENCES "MailAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MailOAuthState" ADD CONSTRAINT "MailOAuthState_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
