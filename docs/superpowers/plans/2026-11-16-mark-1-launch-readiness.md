# MARK-1 Integration and Launch Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Validate the external dependencies, verify cross-component security and end-to-end behavior, and produce deployable service and browser artifacts with an honest production launch checklist.

**Architecture:** Keep production packaging provider-neutral using containers and environment configuration. Gate all real platform integration on authorized documentation and staging access; gate live payment, email, hosting, deployment, and store publication on user-provided credentials and explicit approval.

**Tech Stack:** Docker, PostgreSQL, CI, Vitest, Playwright, WXT browser packages, secure environment/secret configuration.

**Spec:** `docs/superpowers/specs/2026-11-15-mark-1-browser-extension-design.md` and the foundation, payments, and extension plans in this directory.

## Global Constraints

- Use **MARK-1** as the only product/project name.
- User-facing copy must say **Customer** or **User**, never “Teacher.”
- Keep actual institution/vendor names, domains, tenant subdomains, emails, contacts, credentials, and external identifiers out of generic source/docs.
- Never store external passwords, session cookies, AI keys, page content, card data, or unnecessary personal data in MARK-1 services.
- Razorpay signatures are verified before access changes; duplicate/replayed events are idempotent.
- The API is authoritative for entitlements; browser redirects never grant access.
- Unknown/ambiguous assessment modes default to manual review; submission is manual by default.
- Do not bypass site policy, access controls, anti-automation, CAPTCHAs, or restricted assessments.
- The initial browser targets are Chrome, Edge, and Brave; Firefox is not a v1 promise.
- Production deployment and browser-store publication require separate explicit approval.

## Review Focus

- Missing production secrets/configuration must fail closed and must not start an unsafe service; pin in `config.productionRejectsMissingSecrets` (Task 2).
- A migration failure must not leave a half-applied schema or silently discard purchase data; pin in `deployment.migrationFailureStopsRelease` (Task 2).
- Cross-origin requests and webhook requests must enforce the configured origin/signature policy; pin in `security.corsRejectsUnknownOrigin` and `security.webhookRequiresVerifiedSignature` (Task 2).
- Logs, traces, crash reports, and error responses must redact keys, question text, tokens, and external identifiers; pin in `privacy.redactsSensitiveValuesAcrossSinks` (Task 2).
- An unverified or unavailable platform integration must not enable page mutation/submission or be represented as launch-supported; pin in `release.unverifiedAdapterCannotBeEnabled` (Tasks 1 and 3).

---

## File Map

- `apps/api/Dockerfile`, `apps/web/Dockerfile`, `apps/extension/` build scripts: reproducible build artifacts.
- `compose.yaml`: local PostgreSQL and mail-capture dependencies only.
- `apps/api/src/health/`: readiness/liveness checks.
- `scripts/release/`: environment validation, migration check, extension bundle validation.
- `.github/workflows/ci.yml` and `.github/workflows/release-check.yml`: repeatable verification.
- `docs/deployment/`: environment variables, secret setup, migrations, backups, monitoring, incident response, rollback, and release checklist.

## Task 1: Authorized integration discovery and go-live dependency record

**Files:**
- Modify: `docs/superpowers/specs/2026-11-15-mark-1-browser-extension-design.md` only to record verified generic capabilities and unresolved dependencies; never put real domains or credentials there.
- Create: `docs/deployment/integration-readiness.md`
- Test: `apps/extension/src/platform/__tests__/registry-policy.test.ts`

**Interfaces:**
- `IntegrationReadiness`: `{ linkMethodVerified: boolean; stagingAccessVerified: boolean; approvedWorkflowIds: string[]; allowedActions: Array<"capture" | "insert" | "select" | "submit">; evidenceReference: string }`
- `evidenceReference` points to a secure, access-controlled source; it must not contain credentials or customer page content.

- [ ] **Step 1: Write failing registry-policy tests** proving that an integration with missing link verification, staging verification, approved workflows, or allowed actions cannot be enabled.
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- registry-policy`; confirm an unverified integration currently appears unavailable.**
- [ ] **Step 3: Record the discovery checklist and secure evidence reference.** The user reports some authorized details are available, but exact link method, workflow, test pages, and staging access are not present in this repo; do not guess them or request secrets in chat.
- [ ] **Step 4: Implement a fail-closed integration registry gate** and keep real-site integration disabled until every required field is verified.
- [ ] **Step 5: Run `pnpm --filter @mark-1/extension test -- registry-policy`; confirm all incomplete integrations remain disabled.**

## Task 2: Cross-component security, local integration environment, and release checks

**Files:**
- Create: `compose.yaml`, `apps/api/Dockerfile`, `apps/web/Dockerfile`
- Create: `apps/api/src/health/{live,ready}.ts`, `scripts/release/{validate-env,check-migrations,check-extension-bundle}.ts`
- Create: `apps/e2e/playwright.config.ts`, `apps/e2e/tests/fixtures/{fake-platform,mail-capture}.ts`
- Modify: `.github/workflows/ci.yml`; create `.github/workflows/release-check.yml`
- Create: `docs/deployment/{configuration,operations,security,rollback}.md`
- Test: `apps/api/src/__tests__/security/*.test.ts`, `scripts/release/__tests__/*.test.ts`, `apps/e2e/tests/*.spec.ts`

**Interfaces:**
- `validateProductionEnv(env: NodeJS.ProcessEnv): { valid: true } | { valid: false; missing: string[] }`
- `GET /health/live` reports process liveness only; `GET /health/ready` reports database and required dependency readiness without disclosing secrets.
- `pnpm e2e` runs local web/API/PostgreSQL/mail-capture flow with provider stubs.

- [ ] **Step 1: Write failing checks** for missing production secrets, unknown CORS origins, redacted logs/errors, migration failure handling, and unauthorized webhook rejection.
- [ ] **Step 2: Run `pnpm test -- security release`; confirm the corresponding checks fail before implementation.**
- [ ] **Step 3: Add Dockerfiles, local Compose services, readiness endpoints, strict production-env validation, and release-check scripts.** Do not include production secrets or actual platform identifiers in Compose, CI, or docs.
- [ ] **Step 4: Add the E2E journey:** register and verify customer using mail capture; link through a fake test verifier; make a Razorpay sandbox/stub payment; process a signed webhook; verify entitlement; sign into extension; store a local test key; run a Gemini stub; exercise the local practice fixture; verify no question/key data reaches the MARK-1 API.
- [ ] **Step 5: Run `pnpm lint && pnpm typecheck && pnpm test && pnpm e2e && pnpm build`; confirm all checks pass from a clean checkout.**

## Task 3: Browser packages, deployment runbooks, and launch gates

**Files:**
- Create: `scripts/release/package-browsers.ts`
- Create: `docs/deployment/{launch-checklist,browser-installation,incident-response}.md`
- Test: `scripts/release/__tests__/browser-packages.test.ts`, `apps/e2e/tests/release-gates.spec.ts`

**Interfaces:**
- `pnpm release:browser` creates separate versioned Chrome, Edge, and Brave packages from the same verified MV3 build.
- `LaunchChecklist` has independent gates for platform authorization, email provider, Razorpay production credentials/webhooks, hosting/domain/TLS, backups/monitoring, privacy/security review, and explicit deployment/store approval.

- [ ] **Step 1: Write failing tests** for package contents, version consistency, absence of development origins/secrets, and disabled real platform integrations when discovery evidence is incomplete.
- [ ] **Step 2: Run `pnpm test -- browser-packages release-gates`; confirm these tests fail until packaging and gates exist.**
- [ ] **Step 3: Implement browser packaging and runbooks.** Document setup and rollback without publishing to a store or deploying to a public environment.
- [ ] **Step 4: Run `pnpm release:browser` and `pnpm test -- browser-packages release-gates`; confirm three valid browser artifacts and correct blocking gates.**

## Production Go-Live Gate

The source tree can be made deployable, but a real launch cannot be honestly marked ready until the authorized platform link/workflow and staging details, email provider, Razorpay production account/webhooks, hosting/domain/TLS, and required business/privacy approvals are configured and verified. Never deploy or publish without the user's explicit approval. Mock services prove application behavior, not external authorization, billing readiness, or live-site compatibility.
