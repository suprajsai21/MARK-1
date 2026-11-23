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
- [ ] **Email Provider (SMTP):** Production SMTP credentials configured (`SMTP_URL` with TLS/secure flag, `EMAIL_FROM`).
- [ ] **Razorpay Payment Gateway:** Production or active test API credentials configured (`RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`).
- [ ] **Razorpay Webhook Registration:** Endpoint `POST /v1/webhooks/razorpay` registered with matching secret in Razorpay dashboard.
- [x] **Fail-Closed Coursework Adapters:** Academic platform adapters (e.g. CodeTantra) safely disabled in registry pending authorized verification.

## 4. Frontend & Browser Distribution Gate
- [x] **Web Portal SPA:** Vite production build compiling clean.
- [x] **Chrome MV3 Extension:** Built with background service worker and sidepanel.
- [ ] **Browser Packages:** Run `corepack pnpm release:browser` from the repository root and verify generated packages under `apps/extension/.output/browser-packages/`. The current script copies the same Chromium zip for Chrome, Edge, and Brave; verify each target manifest/install process before claiming browser-specific store readiness.
- [ ] **Extension Identity Registration:** Chrome Web Store developer listing and client ID registration (`OAUTH_CLIENT_ID`).

## 5. Deployment Infrastructure Gate
- [x] **Docker Multi-stage Builds:** Container definitions for `apps/api` and `apps/web` (with nginx).
- [x] **Environment Validation:** Pre-flight validation script `node scripts/release/check-env.mjs`.
- [ ] **Hosting / Cloud Deployment:** Follow [`nelctro-shop-cloudflare.md`](./nelctro-shop-cloudflare.md) for the `nelctro.shop` Cloudflare Tunnel deployment. It uses the existing Compose stack and a same-origin `/v1/*` proxy; no inbound ports are needed.
  - Set `WEB_ORIGIN=https://nelctro.shop`, `TRUST_PROXY=1`, and `SECURE_COOKIES=1`; configure production mail/OAuth/payment secrets in the host's secret manager. Never commit `.env`.
  - Configure the Cloudflare Tunnel hostname `nelctro.shop` -> `http://localhost:8080`; bypass CDN caching on `/v1/*` and `/health/*`, and skip WAF challenges on `/v1/webhooks/razorpay`.
  - Run migrations and `docker compose up -d --build`; verify `https://nelctro.shop/healthz`, `https://nelctro.shop/health/ready`, and `bash scripts/release/smoke.sh https://nelctro.shop`.
  - Configure PostgreSQL backup/restore, uptime monitoring, automated rollback, and complete a restore test before public launch.
  - Browser extension release remains separate; package builds with `corepack pnpm release:browser` and register production OAuth client IDs/redirect URIs.
