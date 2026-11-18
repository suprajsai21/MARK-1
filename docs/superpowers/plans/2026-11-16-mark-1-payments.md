# MARK-1 Payments and Entitlements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add admin-managed INR pricing, one-time Razorpay checkout, verified idempotent payment/refund handling, and authoritative access entitlements.

**Architecture:** Razorpay checkout is created server-side after the verified customer has linked an account. Only verified signed payment events may grant access; checkout return pages display status but never grant entitlement. Price, order, event, purchase, refund, and entitlement changes are persisted transactionally in PostgreSQL.

**Tech Stack:** Fastify, TypeScript, Prisma, PostgreSQL, Razorpay Node SDK, Zod contracts, Vitest.

**Spec:** `docs/superpowers/specs/2026-11-15-mark-1-browser-extension-design.md` and `docs/superpowers/plans/2026-11-16-mark-1-foundation.md`

## Global Constraints

- Use **MARK-1** as the only product/project name.
- User-facing copy must say **Customer** or **User**, never “Teacher.”
- Sell in India through Razorpay using a one-time payment; admins control price.
- A one-time purchase grants continuing access to the purchased product version; verified refunds or chargebacks revoke it.
- The API is authoritative for entitlements; browser return pages never grant access.
- Verify Razorpay signatures before granting access; duplicate/replayed events must be safe.
- Store payment/provider IDs and status, not card details.
- MARK-1 never pays for AI usage; BYOK Gemini usage is paid directly by the customer.
- Do not store page content, external credentials, or AI keys in MARK-1 services or logs.
- Production credentials are supplied through secure environment configuration and never committed.
- Production deployment and browser-store publication require separate explicit approval.

## Review Focus

- Forged or missing webhook signatures must not alter purchase or entitlement state; pin in `razorpay.webhook.rejectsInvalidSignature` (Task 3).
- Duplicate, replayed, or out-of-order events must not duplicate purchases or restore refunded access; pin in `razorpay.webhook.isIdempotentAcrossReplayAndOrder` (Task 3).
- A payment with the wrong amount, currency, or order ID must not grant access; pin in `payments.capture.requiresMatchingOrderAmountAndCurrency` (Task 2).
- Refund/chargeback races must resolve to revoked entitlement; pin in `payments.refundWinsConcurrentCapture` (Task 3).
- A price change after checkout creation must not change the amount or product version attached to that purchase; pin in `pricing.checkoutSnapshotsPriceVersion` (Tasks 1–2).

---

## File Map

- `packages/db/prisma/schema.prisma`: immutable price versions, checkout orders, payment event ledger, purchase/refund records, entitlements.
- `packages/contracts/src/payments.ts`: shared checkout, price, webhook-status, and entitlement schemas.
- `apps/api/src/modules/payments/`: order creation, Razorpay adapter, event verification, idempotent handlers, refund/revocation.
- `apps/api/src/modules/pricing/`: admin price control and public current price.
- `apps/web/src/features/checkout/` and `apps/web/src/features/admin/pricing/`: customer checkout/status and admin price UI.

## Task 1: Pricing, purchase, and entitlement data model

**Files:**
- Modify: `packages/db/prisma/schema.prisma`
- Create: `packages/db/prisma/migrations/*_payments_entitlements/`
- Modify: `packages/contracts/src/index.ts`
- Create: `packages/contracts/src/payments.ts`
- Test: `packages/db/src/__tests__/payments-constraints.test.ts`, `packages/contracts/src/__tests__/payments.test.ts`

**Interfaces:**
- `PriceSnapshot`: `{ productVersionId: string; amountPaise: number; currency: "INR"; version: number }`; API values must be positive safe integers, persisted as database `BIGINT`.
- `EntitlementStatus`: `"active" | "revoked"`
- `PaymentOrderStatus`: `"created" | "paid" | "failed" | "refunded" | "charged_back"`

- [ ] **Step 1: Write failing tests** for paise integer-only pricing, immutable price snapshots, one purchase per provider payment ID, unique provider event IDs, and one entitlement per purchase.
- [ ] **Step 2: Run `pnpm --filter @mark-1/db test -- payments`; confirm all new constraints are absent.**
- [ ] **Step 3: Add the Prisma models and migration.** Persist INR amounts as integer paise; record Razorpay IDs/status only; do not add any card number/CVV fields. Store product version and price snapshot on each order.
- [ ] **Step 4: Run `pnpm --filter @mark-1/db test -- payments`; confirm schema and constraint tests pass against PostgreSQL.**

## Task 2: Admin pricing and one-time checkout creation

**Files:**
- Create: `apps/api/src/modules/pricing/{routes,service}.ts`
- Create: `apps/api/src/modules/payments/{routes,service,razorpay-client}.ts`
- Create: `apps/web/src/features/checkout/{CheckoutPage,PaymentStatusPage}.tsx`
- Create: `apps/web/src/features/admin/pricing/{PricingPage,PriceForm}.tsx`
- Test: `apps/api/src/modules/{pricing,payments}/__tests__/*.test.ts`, `apps/web/src/features/{checkout,admin/pricing}/__tests__/*.test.tsx`

**Interfaces:**
- `PricingService.setCurrentPrice(input: { productVersionId: string; amountPaise: number; actorId: string }): Promise<PriceSnapshot>`
- `CheckoutService.createOrder(input: { userId: string }): Promise<{ orderId: string; amountPaise: bigint; currency: "INR"; razorpayOrderId: string; checkoutKeyId: string }>`
- Routes: `GET /v1/pricing/current`, `PUT /v1/admin/pricing/current`, `POST /v1/checkout/orders`, `GET /v1/checkout/orders/:orderId`, and authenticated `GET /v1/entitlement`.

- [ ] **Step 1: Write failing tests** for admin-only price changes, positive `Number.isSafeInteger` INR paise validation, verified email + linked-account prerequisites, server-side order creation, and immutable order price snapshot.
- [ ] **Step 2: Run `pnpm --filter @mark-1/api test -- pricing payments`; confirm new routes fail before implementation.**
- [ ] **Step 3: Implement pricing and checkout services** using an injected Razorpay client. The browser receives only the public checkout key ID and server-created order details; it cannot select the amount or product version.
- [ ] **Step 4: Implement customer checkout/status and admin price screens.** A redirect/return page may display “processing” or verified status only; it must never set entitlement state.
- [ ] **Step 5: Run `pnpm --filter @mark-1/api test -- pricing payments && pnpm --filter @mark-1/web test`; confirm tests pass.**

## Task 3: Verified webhooks, idempotency, and revocation

**Files:**
- Create: `apps/api/src/modules/payments/{webhook-routes,signature,webhook-service,entitlements}.ts`
- Modify: `apps/api/src/server.ts` to retain raw request body for the Razorpay webhook route only.
- Test: `apps/api/src/modules/payments/__tests__/{webhook-signature,webhook-idempotency,refund-race,entitlement}.test.ts`

**Interfaces:**
- `RazorpayEventVerifier.verify(input: { rawBody: Buffer; signature: string; secret: string }): VerifiedRazorpayEvent`
- `WebhookService.process(event: VerifiedRazorpayEvent): Promise<{ accepted: boolean; duplicate: boolean }>`
- `EntitlementService.getForUser(userId: string): Promise<{ active: boolean; productVersionId?: string }>`
- Route: `POST /v1/webhooks/razorpay`.

- [ ] **Step 1: Write failing tests** for invalid HMAC rejection, duplicate event no-op, mismatched payment/order/amount rejection, capture/refund ordering, and atomic purchase+entitlement update.
- [ ] **Step 2: Run `pnpm --filter @mark-1/api test -- webhook`; confirm tests fail before implementation.**
- [ ] **Step 3: Implement raw-body signature verification and event-ledger processing.** Verify before state change; insert each provider event ID under a unique constraint; apply order, purchase, and entitlement transitions in one transaction; make refund/chargeback revocation terminal for that purchase.
- [ ] **Step 4: Run `pnpm --filter @mark-1/api test -- webhook entitlement`; confirm event replay, race, and state-transition tests pass.**

## Completion Gate

Razorpay test-mode keys are required for a live sandbox smoke test; production keys are not part of the repository. Do not claim payment integration is launch-verified until a signed test webhook has been exercised in the configured environment and its event is visible in the audit trail.
