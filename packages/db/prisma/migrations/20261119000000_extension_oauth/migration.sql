-- OAuth authorization codes and opaque bearer-token hashes; raw credentials are never persisted.
CREATE TABLE "OAuthAuthorizationCode" (
    "codeHash" VARCHAR(64) NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" VARCHAR(256) NOT NULL,
    "redirectUri" VARCHAR(2048) NOT NULL,
    "codeChallenge" VARCHAR(43) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY ("codeHash")
);

CREATE TABLE "OAuthTokenFamily" (
    "id" VARCHAR(32) NOT NULL,
    "userId" UUID NOT NULL,
    "clientId" VARCHAR(256) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthTokenFamily_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "OAuthAccessToken" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "familyId" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthAccessToken_pkey" PRIMARY KEY ("tokenHash")
);

CREATE TABLE "OAuthRefreshToken" (
    "tokenHash" VARCHAR(64) NOT NULL,
    "familyId" VARCHAR(32) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY ("tokenHash")
);

CREATE INDEX "OAuthAuthorizationCode_expiresAt_idx" ON "OAuthAuthorizationCode"("expiresAt");
CREATE INDEX "OAuthAuthorizationCode_userId_idx" ON "OAuthAuthorizationCode"("userId");
CREATE INDEX "OAuthTokenFamily_userId_clientId_idx" ON "OAuthTokenFamily"("userId", "clientId");
CREATE INDEX "OAuthTokenFamily_revokedAt_idx" ON "OAuthTokenFamily"("revokedAt");
CREATE INDEX "OAuthAccessToken_familyId_idx" ON "OAuthAccessToken"("familyId");
CREATE INDEX "OAuthAccessToken_expiresAt_idx" ON "OAuthAccessToken"("expiresAt");
CREATE INDEX "OAuthRefreshToken_familyId_idx" ON "OAuthRefreshToken"("familyId");
CREATE INDEX "OAuthRefreshToken_expiresAt_idx" ON "OAuthRefreshToken"("expiresAt");

ALTER TABLE "OAuthAuthorizationCode" ADD CONSTRAINT "OAuthAuthorizationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthTokenFamily" ADD CONSTRAINT "OAuthTokenFamily_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthAccessToken" ADD CONSTRAINT "OAuthAccessToken_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "OAuthTokenFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OAuthRefreshToken" ADD CONSTRAINT "OAuthRefreshToken_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "OAuthTokenFamily"("id") ON DELETE CASCADE ON UPDATE CASCADE;
