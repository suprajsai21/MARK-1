CREATE TYPE "PaymentOrderStatus" AS ENUM ('created', 'paid', 'failed', 'refunded', 'charged_back');
CREATE TYPE "EntitlementStatus" AS ENUM ('active', 'revoked');

CREATE TABLE "PriceVersion" (
    "id" UUID NOT NULL,
    "productVersionId" VARCHAR(64) NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "version" INTEGER NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdById" UUID NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PriceVersion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PriceVersion_amountPaise_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "PriceVersion_currency_check" CHECK ("currency" = 'INR'),
    CONSTRAINT "PriceVersion_version_check" CHECK ("version" > 0)
);

CREATE TABLE "PaymentOrder" (
    "id" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productVersionId" VARCHAR(64) NOT NULL,
    "priceVersionId" UUID NOT NULL,
    "priceVersion" INTEGER NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "status" "PaymentOrderStatus" NOT NULL DEFAULT 'created',
    "razorpayOrderId" VARCHAR(64) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PaymentOrder_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PaymentOrder_amountPaise_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "PaymentOrder_currency_check" CHECK ("currency" = 'INR')
);

CREATE TABLE "Purchase" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productVersionId" VARCHAR(64) NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "currency" VARCHAR(3) NOT NULL,
    "providerPaymentId" VARCHAR(64) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Purchase_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Purchase_amountPaise_check" CHECK ("amountPaise" > 0),
    CONSTRAINT "Purchase_currency_check" CHECK ("currency" = 'INR')
);

CREATE TABLE "Refund" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "providerRefundId" VARCHAR(64) NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "reason" VARCHAR(32) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Refund_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Refund_amountPaise_check" CHECK ("amountPaise" > 0)
);

CREATE TABLE "Entitlement" (
    "id" UUID NOT NULL,
    "purchaseId" UUID NOT NULL,
    "userId" UUID NOT NULL,
    "productVersionId" VARCHAR(64) NOT NULL,
    "status" "EntitlementStatus" NOT NULL DEFAULT 'active',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "revokeReason" VARCHAR(32),
    CONSTRAINT "Entitlement_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "PaymentEvent" (
    "id" UUID NOT NULL,
    "providerEventId" VARCHAR(64) NOT NULL,
    "eventType" VARCHAR(64) NOT NULL,
    "payloadDigest" VARCHAR(64) NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    CONSTRAINT "PaymentEvent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PriceVersion_productVersionId_version_key" ON "PriceVersion"("productVersionId", "version");
CREATE INDEX "PriceVersion_productVersionId_isCurrent_idx" ON "PriceVersion"("productVersionId", "isCurrent");
CREATE UNIQUE INDEX "PaymentOrder_razorpayOrderId_key" ON "PaymentOrder"("razorpayOrderId");
CREATE INDEX "PaymentOrder_userId_idx" ON "PaymentOrder"("userId");
CREATE INDEX "PaymentOrder_status_idx" ON "PaymentOrder"("status");
CREATE UNIQUE INDEX "Purchase_orderId_key" ON "Purchase"("orderId");
CREATE UNIQUE INDEX "Purchase_providerPaymentId_key" ON "Purchase"("providerPaymentId");
CREATE INDEX "Purchase_userId_idx" ON "Purchase"("userId");
CREATE UNIQUE INDEX "Refund_providerRefundId_key" ON "Refund"("providerRefundId");
CREATE INDEX "Refund_purchaseId_idx" ON "Refund"("purchaseId");
CREATE UNIQUE INDEX "Entitlement_purchaseId_key" ON "Entitlement"("purchaseId");
CREATE INDEX "Entitlement_userId_status_idx" ON "Entitlement"("userId", "status");
CREATE UNIQUE INDEX "PaymentEvent_providerEventId_key" ON "PaymentEvent"("providerEventId");
CREATE INDEX "PaymentEvent_eventType_idx" ON "PaymentEvent"("eventType");
CREATE INDEX "PaymentEvent_receivedAt_idx" ON "PaymentEvent"("receivedAt");

ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PaymentOrder" ADD CONSTRAINT "PaymentOrder_priceVersionId_fkey" FOREIGN KEY ("priceVersionId") REFERENCES "PriceVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "PaymentOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Purchase" ADD CONSTRAINT "Purchase_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Refund" ADD CONSTRAINT "Refund_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "Purchase"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Entitlement" ADD CONSTRAINT "Entitlement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
