-- Account linking stores only opaque challenge hashes and HMACed external subjects.
CREATE TABLE "LinkChallenge" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "integrationId" VARCHAR(64) NOT NULL,
    "challengeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkChallenge_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AccountLink" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "integrationId" VARCHAR(64) NOT NULL,
    "externalSubjectHash" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccountLink_pkey" PRIMARY KEY ("id")
);

-- Immutable unlink records retain enough data to enforce the cooldown after removal.
CREATE TABLE "LinkHistory" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "integrationId" VARCHAR(64) NOT NULL,
    "unlinkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkHistory_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LinkAudit" (
    "id" UUID NOT NULL,
    "actorId" UUID NOT NULL,
    "action" VARCHAR(32) NOT NULL,
    "targetId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LinkAudit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LinkPolicySetting" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "relinkCooldownHours" INTEGER NOT NULL DEFAULT 168,
    "requiresReverification" BOOLEAN NOT NULL DEFAULT true,
    "adminTransferApprovalRequired" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" UUID,
    CONSTRAINT "LinkPolicySetting_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "LinkPolicySetting_singleton_check" CHECK ("id" = 1),
    CONSTRAINT "LinkPolicySetting_cooldown_check" CHECK ("relinkCooldownHours" >= 1 AND "relinkCooldownHours" <= 8760)
);

CREATE UNIQUE INDEX "AccountLink_userId_integrationId_key" ON "AccountLink"("userId", "integrationId");
CREATE UNIQUE INDEX "AccountLink_integrationId_externalSubjectHash_key" ON "AccountLink"("integrationId", "externalSubjectHash");
CREATE INDEX "LinkChallenge_userId_idx" ON "LinkChallenge"("userId");
CREATE INDEX "LinkChallenge_expiresAt_idx" ON "LinkChallenge"("expiresAt");
CREATE INDEX "AccountLink_userId_idx" ON "AccountLink"("userId");
CREATE INDEX "LinkHistory_userId_integrationId_unlinkedAt_idx" ON "LinkHistory"("userId", "integrationId", "unlinkedAt");
CREATE INDEX "LinkHistory_unlinkedAt_idx" ON "LinkHistory"("unlinkedAt");
CREATE INDEX "LinkAudit_actorId_idx" ON "LinkAudit"("actorId");
CREATE INDEX "LinkAudit_createdAt_idx" ON "LinkAudit"("createdAt");

ALTER TABLE "LinkChallenge" ADD CONSTRAINT "LinkChallenge_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AccountLink" ADD CONSTRAINT "AccountLink_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LinkHistory" ADD CONSTRAINT "LinkHistory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
