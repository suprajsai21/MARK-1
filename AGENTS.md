# MARK-1 Developer & Agent Directives

## 1. Product Identity & Terminology
- The product name is strictly **MARK-1**.
- User-facing copy must always use **Customer** or **User**, never "Teacher".
- Fixed pricing: **₹49.00 INR (4,900 integer paise)** one-time purchase conferring a permanent, versioned entitlement (`mark1-v1`).

## 2. Security & Zero-Secrets Policy
- Zero tolerance for hardcoded or exposed secrets in git, command output, logs, or chat.
- All secrets belong in local, git-ignored `.env` files or secret managers only.
- Sessions and access tokens are opaque, high-entropy tokens stored as hashes in PostgreSQL via Argon2id/SHA-256. No JWT secrets exist or should be hallucinated.
- MARK-1 acts as its own native OAuth 2.0 Authorization Server with PKCE S256 for the browser extension.

## 3. Academic Integrity & Integration Safety
- Strict prohibition against live coursework solving, page auto-answering, or automated quiz/exam submission.
- Real platform adapters (e.g. CodeTantra) must remain disabled in the registry (`fail-closed`) until authorized documentation and staging credentials are provided.

## 4. Technology Stack & Commands
- **Monorepo:** pnpm workspace managed with Corepack. Always run package manager commands using `corepack pnpm`.
- **Backend:** Node.js 22 LTS, Fastify 5, Prisma 6.19.0 with PostgreSQL (Neon serverless).
- **Frontend:** React 19, Vite 7, Tailwind CSS, TypeScript.
- **Browser Extension:** Chrome MV3 via WXT framework, background service worker, sidepanel UI.
- **Testing:** Vitest for unit/integration tests, Playwright for E2E release gates.
- **Commands:**
  - Tests: `corepack pnpm test`
  - Typecheck: `corepack pnpm typecheck`
  - Lint: `corepack pnpm lint`
  - Build: `corepack pnpm build`
  - Browser Packaging: `corepack pnpm release:browser`
