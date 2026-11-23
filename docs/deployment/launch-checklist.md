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
- [ ] **Hosting / Cloud Deployment:** Choose Railway or a Linux VPS, provision a PostgreSQL 16 database (or use the bundled Compose `db` service), and deploy the API + web containers from the repository root using `compose.yaml`.
  - Configure the production values in the host's secret/environment manager; use `docs/deployment/configuration.md` as the authoritative variable list. Set `NODE_ENV=production`, a strong unique `POSTGRES_PASSWORD`, `WEB_ORIGIN=https://<your-domain>`, and `DATABASE_URL` to the production database. Set Razorpay key ID, key secret, and webhook secret together; register `POST https://<api-domain>/v1/webhooks/razorpay` with the same webhook secret.
  - Publish the web container on the public HTTPS domain and route `/v1/*` to the API service (or publish the API on a dedicated HTTPS subdomain and set the web/API origins accordingly). Configure the platform's TLS certificate and DNS records; do not expose PostgreSQL publicly.
  - Run `docker compose config` before deployment, then `docker compose up -d --build`. Verify `GET /healthz` on both the API and web domains, execute the auth/signup and checkout smoke tests, and inspect logs for startup/configuration errors.
  - Configure persistent storage/backups for PostgreSQL, automated image updates and rollback, uptime/error monitoring, and a documented restore test before public launch.
  - Browser extension release remains a separate distribution step; package signed/approved browser builds with `corepack pnpm release:browser` and register the production OAuth extension client IDs/redirect URIs.
