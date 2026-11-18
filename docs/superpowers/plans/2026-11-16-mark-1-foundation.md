# MARK-1 Foundation and Identity Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the MARK-1 monorepo foundation, customer authentication, verified email, generic one-to-one account-link protocol, and customer/admin portal foundation.

**Architecture:** Use a pnpm TypeScript monorepo with a Fastify API, React/Vite web portal, shared Zod contracts, and a Prisma/PostgreSQL data layer. Authentication and link verification are server-owned; a platform-link verifier remains disabled until authorized platform details are configured.

**Tech Stack:** Node.js active LTS, pnpm, TypeScript strict mode, Fastify, React/Vite, Zod, Prisma, PostgreSQL, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-mark-1-browser-extension-design.md`

## Global Constraints

- Use **MARK-1** as the only product/project name.
- User-facing copy must say **Customer** or **User**, never “Teacher.”
- Use generic integration language; never hardcode real institution/vendor names, domains, tenant subdomains, emails, or contacts.
- BYOK is Gemini-only for v1; MARK-1 never pays for model usage.
- Never collect or store the external website password or session cookies.
- Do not store page content, external credentials, or AI keys in MARK-1 services.
- Do not bypass site policies, access controls, anti-automation checks, CAPTCHAs, or restricted assessments.
- Never claim hidden tests ran or submission succeeded without observable evidence.
- Unknown or ambiguous assessment modes default to non-automating/manual review.
- Initial browser targets are Chrome, Edge, and Brave; Firefox may follow later.
- Production deployment and browser-store publication require separate explicit approval.

## Review Focus

- Case-variant or duplicate email registrations must not create multiple accounts; pin in `auth.register.normalizesEmailAndRejectsDuplicate` (Task 2).
- Expired, consumed, or replayed email-verification tokens must not verify an account; pin in `auth.verifyEmail.rejectsExpiredAndReplayedTokens` (Task 2).
- Concurrent link attempts for one platform identity must preserve both one-to-one uniqueness constraints; pin in `links.complete.rejectsDuplicateIdentityUnderConcurrency` (Task 3).
- An unverified customer or non-admin must not reach protected routes; pin in `auth.protectedRoutes.requireVerifiedUser` and `admin.routes.rejectNonAdmin` (Tasks 2–3).
- Missing email delivery or verifier configuration must fail closed without exposing tokens or activating a link; pin in `auth.registration.emailFailureIsRecoverable` and `links.complete.disabledVerifierReturnsUnavailable` (Tasks 2–3).

---

## File Map

- `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.env.example`: workspace scripts, strict shared tooling, and safe configuration documentation.
- `packages/contracts/src/`: Zod request/response contracts shared by web, extension, and API.
- `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`: durable account, link, session, and audit data.
- `apps/api/src/modules/auth/`: email verification, password hashing/reset, customer sessions, and extension OAuth.
- `apps/api/src/modules/links/`: challenge lifecycle, transfer/cooldown policy, and disabled-by-default verifier port.
- `apps/api/src/plugins/`: request validation, authentication, admin authorization, CORS, CSRF, and rate limits.
- `apps/web/src/features/auth/` and `apps/web/src/features/account/`: customer sign-up, sign-in, verification, password recovery, and linked-account status.
- `.github/workflows/ci.yml`: lint, typecheck, test, and build checks.

## Task 1: Monorepo, contracts, and CI foundation

**Files:**
- Create: `package.json`, `pnpm-workspace.yaml`, `tsconfig.base.json`, `eslint.config.mjs`, `.gitignore`, `.env.example`, `.github/workflows/ci.yml`
- Create: `packages/contracts/package.json`, `packages/contracts/tsconfig.json`, `packages/contracts/src/index.ts`, `packages/contracts/src/auth.ts`, `packages/contracts/src/links.ts`
- Create: `apps/api/package.json`, `apps/api/tsconfig.json`, `apps/api/src/server.ts`
- Create: `apps/web/package.json`, `apps/web/tsconfig.json`, `apps/web/vite.config.ts`, `apps/web/src/main.tsx`, `apps/web/index.html`
- Create: `apps/extension/package.json`, `apps/e2e/package.json`
- Test: `packages/contracts/src/__tests__/auth.test.ts`, `packages/contracts/src/__tests__/links.test.ts`

**Interfaces:**
- Produces package `@mark-1/contracts` with `RegisterInput`, `LoginInput`, `AuthUser`, `CreateLinkChallengeInput`, `CompleteLinkInput`, and `ApiError` Zod schemas and inferred TypeScript types.
- Workspace package names: `@mark-1/contracts`, `@mark-1/db`, `@mark-1/api`, `@mark-1/web`, `@mark-1/extension`, and `@mark-1/e2e`.
- Root scripts: `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm e2e`, and `pnpm build`.

- [ ] **Step 1: Write failing contract tests** for valid/invalid email input, password length policy, link challenge shape, and structured API errors.
- [ ] **Step 2: Run `pnpm --filter @mark-1/contracts test`; confirm the named tests fail because schemas are absent.**
- [ ] **Step 3: Create the workspace and schemas** with `additionalProperties: false` semantics, strict TypeScript, and shared exports. Pin resolved dependency versions in `pnpm-lock.yaml`.
- [ ] **Step 4: Run `pnpm lint && pnpm typecheck && pnpm test && pnpm build`; confirm all workspace checks pass.**

## Task 2: Persistence, customer authentication, and email verification

**Files:**
- Create: `packages/db/package.json`, `packages/db/prisma/schema.prisma`, `packages/db/src/client.ts`, `packages/db/src/__tests__/constraints.test.ts`
- Create: `apps/api/src/modules/auth/{routes,service,passwords,tokens,email-sender,sessions}.ts`
- Create: `apps/api/src/plugins/{auth,rate-limit,validation}.ts`
- Test: `apps/api/src/modules/auth/__tests__/{register,login,verify-email,sessions}.test.ts`

**Interfaces:**
- `AuthService.register(input: RegisterInput): Promise<{ userId: string; verificationDispatchAttempted: true }>`
- `AuthService.login(input: LoginInput): Promise<{ user: AuthUser; sessionCookie: string }>`; the cookie value is never included in JSON.
- `AuthService.verifyEmail(input: { token: string }): Promise<{ verified: true }>`
- `AuthService.requestPasswordReset(input: { email: string }): Promise<{ accepted: true }>`
- `AuthService.resetPassword(input: { token: string; newPassword: string }): Promise<{ changed: true }>`
- `EmailSender.sendVerificationEmail(input: { to: string; verificationUrl: string; expiresAt: Date }): Promise<void>` and `sendPasswordResetEmail(input: { to: string; resetUrl: string; expiresAt: Date }): Promise<void>`
- Routes: `POST /v1/auth/register`, `POST /v1/auth/login`, `POST /v1/auth/verify-email`, `POST /v1/auth/verify-email/resend`, `POST /v1/auth/password/reset/request`, `POST /v1/auth/password/reset/complete`, `POST /v1/auth/logout`, and `GET /v1/me`.

- [ ] **Step 1: Write failing tests** for normalized duplicate email, 12–128 character password bounds, Argon2id password verification, generic login/reset-request responses, one-use verification/reset tokens, secure session cookie attributes, and recoverable email delivery failure.
- [ ] **Step 2: Run `pnpm --filter @mark-1/api test -- auth`; confirm the expected auth tests fail before implementation.**
- [ ] **Step 3: Implement the schema and auth module.** Persist only hashes of verification/reset tokens; expire verification tokens after 24 hours and reset tokens after 30 minutes; use HttpOnly, Secure, SameSite=Lax cookies plus Origin/CSRF checks for the web portal; rate-limit auth endpoints. Email delivery is an injected adapter; local development uses a mail-capture service, production requires configured SMTP/provider settings. If delivery fails, keep the account unverified and allow a rate-limited resend; never return a token in an API response.
- [ ] **Step 4: Run `pnpm --filter @mark-1/db test && pnpm --filter @mark-1/api test -- auth`; confirm uniqueness, expiry, replay, reset, and auth tests pass.**

## Task 3: One-to-one link challenge, authorization, and customer portal

**Files:**
- Create: `apps/api/src/modules/links/{routes,service,verifier}.ts`
- Create: `apps/api/src/modules/admin/{authorization,routes}.ts`
- Create: `apps/web/src/features/auth/{RegisterPage,LoginPage,VerifyEmailPage,PasswordResetRequestPage,PasswordResetPage}.tsx`
- Create: `apps/web/src/features/account/{AccountPage,LinkAccountPanel}.tsx`
- Create: `apps/web/src/lib/api-client.ts`, `apps/web/src/lib/session.ts`
- Test: `apps/api/src/modules/links/__tests__/{challenge,completion,authorization}.test.ts`, `apps/web/src/features/{auth,account}/__tests__/*.test.tsx`

**Interfaces:**
- `PlatformLinkVerifier.verify(input: { integrationId: string; challengeId: string; proof: string }): Promise<{ externalSubject: string } | null>`
- `LinkService.createChallenge(input: { userId: string; integrationId: string }): Promise<{ challengeId: string; challenge: string; expiresAt: string }>`
- `LinkService.complete(input: { userId: string; challengeId: string; proof: string }): Promise<{ linkId: string; status: "linked" }>`
- `LinkPolicy`: `{ relinkCooldownHours: number; requiresReverification: true; adminTransferApprovalRequired: boolean }`; proposed default cooldown is 168 hours, configurable by an authorized admin.
- Routes: `POST /v1/links/challenges`, `POST /v1/links/complete`, `GET /v1/links`, `DELETE /v1/links/:linkId`, `GET /v1/admin/link-policy`, and `PUT /v1/admin/link-policy`.

- [ ] **Step 1: Write failing tests** for hashed 15-minute single-use challenges, disabled verifier behavior, duplicate link rejection under concurrency, relink cooldown/re-verification, audit records for link/unlink, and non-admin rejection on admin routes.
- [ ] **Step 2: Run `pnpm --filter @mark-1/api test -- links`; confirm these tests fail before implementation.**
- [ ] **Step 3: Implement link persistence and route guards.** Enforce unique `(userId, integrationId)` and `(integrationId, externalSubjectHash)` constraints in PostgreSQL; store an HMAC of the verified external subject rather than the raw identifier; retain unlink history to enforce configurable cooldown; require verified customer identity and re-verification; return unavailable when no approved verifier is configured. Do not invent an external verification mechanism.
- [ ] **Step 4: Implement customer registration, verification, sign-in, password recovery, and account-link status screens using the shared contracts.** Admin role assignment must be out-of-band and audited; no public self-promotion route.
- [ ] **Step 5: Run `pnpm --filter @mark-1/api test -- links && pnpm --filter @mark-1/web test`; confirm API and portal tests pass.**

## Task 4: Extension OAuth authorization bridge

**Files:**
- Create: `apps/api/src/modules/oauth/{routes,service,token-store}.ts`
- Create: `apps/web/src/features/auth/ExtensionConsentPage.tsx`
- Modify: `packages/db/prisma/schema.prisma` for hashed one-time authorization codes and refresh-token families.
- Modify: `packages/contracts/src/auth.ts` for authorization-code and token-exchange schemas.
- Test: `apps/api/src/modules/oauth/__tests__/{pkce,redirect-allowlist,rotation,replay}.test.ts`

**Interfaces:**
- `OAuthService.createAuthorizationCode(input: { userId: string; clientId: string; redirectUri: string; codeChallenge: string; consented: true }): Promise<{ redirectUrl: string }>`
- `OAuthService.exchange(input: { code: string; clientId: string; redirectUri: string; codeVerifier: string }): Promise<{ accessToken: string; expiresIn: 900; refreshToken: string }>`
- Routes: `GET /v1/oauth/authorize` displays consent; `POST /v1/oauth/authorize` creates a code after authenticated, CSRF-protected consent; `POST /v1/oauth/token` exchanges/rotates tokens; `POST /v1/oauth/revoke` revokes a token family.

- [ ] **Step 1: Write failing tests** for S256 PKCE mismatch, unapproved client/redirect rejection, one-time code replay, code expiry, refresh-token rotation/reuse revocation, and revoked access.
- [ ] **Step 2: Run `pnpm --filter @mark-1/api test -- oauth`; confirm these tests fail before implementation.**
- [ ] **Step 3: Implement OAuth authorization for an already authenticated web customer.** `GET` only renders consent; a CSRF-protected `POST` issues a 5-minute, one-use authorization code bound to exact configured extension client/redirect values and PKCE S256. Issue 15-minute opaque access tokens and 30-day rotating refresh tokens; store only token hashes and revoke a token family on refresh-token reuse. Keep extension IDs/redirect values in deployment configuration, not generic source code.
- [ ] **Step 4: Run `pnpm --filter @mark-1/api test -- oauth`; confirm PKCE, redirect, expiry, replay, and rotation tests pass.**

## Completion Gate

This plan delivers the platform-independent foundation. The link verifier is not launch-enabled until authorized linking documentation, permitted workflows, and staging access are verified through the secure channel described in the design. Do not treat a successful mock verifier test as proof of real platform authorization.
