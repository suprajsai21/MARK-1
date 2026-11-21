# MARK-1 Launch Gate Checklist

This runbook tracks the strict operational gates required before public production deployment. Every gate must be checked and verified.

## 1. Database & Persistence Gate
- [x] **Neon Serverless PostgreSQL:** Instance provisioned, pooled connection endpoint active.
- [x] **Prisma Migrations:** Deployed and verified up-to-date (4 migrations applied).
- [x] **Initial Price Seed:** Initial active price record seeded in database: **₹49.00 INR (4,900 paise)** for `mark1-v1`.
- [x] **Admin User Bootstrap:** Initial administrator account created for price and link management (`admin@mark1.internal`).

## 2. API Runtime & Probes Gate
- [x] **Liveness Probe (`/health/live`):** Returns HTTP 200 `{ "status": "ok" }`.
- [x] **Readiness Probe (`/health/ready`):** Returns HTTP 200 `{ "status": "ready" }` validating database connectivity, OAuth store, and entitlement lookup without credential exposure.
- [x] **Release Gate Verification:** Automated Playwright release gate checks pass against live compiled server.
- [x] **Zero Secrets Policy:** No credentials or database passwords stored in source control or exposed in logs.

## 3. External Integrations Gate
- [ ] **Email Provider (Resend SMTP):** Verified sender domain, `EMAIL_FROM`, and `SMTP_URL` plus `SMTP_SECURE=true` stored in Railway API variables; verify live delivery. See [`MARK1_RESEND_SETUP.md`](../MARK1_RESEND_SETUP.md).
- [ ] **Razorpay Payment Gateway:** Production or active test API credentials configured (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).
- [ ] **Razorpay Webhook Registration:** Endpoint `POST /v1/checkout/webhook` registered with matching secret in Razorpay dashboard.
- [x] **Fail-Closed Coursework Adapters:** Academic platform adapters (e.g. CodeTantra) safely disabled in registry pending authorized verification.

## 4. Frontend & Browser Distribution Gate
- [x] **Web Portal SPA:** Vite production build compiling clean.
- [x] **Chrome MV3 Extension:** Built with background service worker and sidepanel.
- [x] **Browser Packages:** Versioned distribution packages generated:
  - `mark-1-extension-v1.0.0-chrome.zip`
  - `mark-1-extension-v1.0.0-edge.zip`
  - `mark-1-extension-v1.0.0-brave.zip`
- [ ] **Extension Identity Registration:** Chrome Web Store developer listing and client ID registration (`OAUTH_CLIENT_ID`).

## 5. Deployment Infrastructure Gate
- [x] **Docker Multi-stage Builds:** Container definitions for `apps/api` and `apps/web` (with nginx).
- [x] **Environment Validation:** Pre-flight validation script `node scripts/release/check-env.mjs`.
- [ ] **Hosting / Cloud Deployment:** Railway / VPS / Cloud hosting target setup and DNS domain configuration.
