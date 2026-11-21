# Architecture & Contracts Rules

1. **Contracts Package (`@mark-1/contracts`):**
   - Single source of truth for DTOs, request/response types, and domain interfaces shared across web, API, and extension.
   - Built with strict TypeScript compiler options and bundled declarations in `./dist/`.
2. **Database Package (`@mark-1/db`):**
   - Prisma ORM encapsulating all relational data models.
   - Migrations are versioned in `prisma/migrations/`.
   - Never reset or drop the Neon database without explicit confirmation.
3. **API (`apps/api`):**
   - Fastify 5 architecture with modular route registrations (`/modules/auth`, `/modules/payments`, `/modules/pricing`, `/modules/oauth`, `/modules/links`).
   - Unauthenticated liveness probe at `/health/live` returns 200 `{ status: "ok" }`.
   - Dependency readiness probe at `/health/ready` returns 200 or 503 without revealing secrets.
4. **Web Frontend (`apps/web`):**
   - React 19 SPA built with Vite.
   - State management via typed hooks and context providers.
5. **Browser Extension (`apps/extension`):**
   - Built on WXT framework targeting Chrome MV3.
   - Background service worker router handling `pageCapture`, `pageInsert`, and OAuth tokens.
   - Sidepanel UI displaying live status and workflow controls.
