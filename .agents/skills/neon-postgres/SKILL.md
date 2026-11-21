---
name: neon-postgres
description: Manage Prisma schema, Neon serverless PostgreSQL connection pooling, and safe migration lifecycles.
---

# Neon PostgreSQL Skill for MARK-1

## Database Operations
1. **Connection Strings:**
   - **Pooled URL (`-pooler`):** Required for Fastify API service runtime to handle concurrent serverless connections gracefully.
   - **Direct URL:** Required for running Prisma migrations (`prisma migrate deploy`) from `packages/db`.
2. **Schema & Migrations:**
   - Prisma schema is located at `packages/db/prisma/schema.prisma`.
   - Never run `prisma migrate reset` in production or staging.
   - Run migrations from `packages/db`: `corepack pnpm --filter @mark-1/db exec prisma migrate deploy`.
3. **Data Integrity:**
   - All purchase entitlements are mapped to `productVersionId` (e.g. `mark1-v1`).
   - Prices stored in integer paise (`BigInt` / integer paise) to avoid floating-point inaccuracies.
