# Neon setup

This project uses Prisma 6.19 and PostgreSQL. Create a Neon project/branch and
use its connection strings as follows:

- API runtime: pooled connection string (hostname contains `-pooler`).
- Prisma migrations: direct connection string (without `-pooler`).

Copy `.env.example` to a local `.env` (git-ignored) and set `DATABASE_URL` to
the pooled URL. Do not put a real URL in source control. Use the direct URL
only for the migration command below; do not commit it or pass it in a shared
terminal transcript.

## Deploy schema migrations

From `packages/db`, after putting the Neon direct URL in the shell's
`DATABASE_URL` variable:

```sh
npx prisma migrate deploy
```

This applies all migrations in `packages/db/prisma/migrations`; it does not
reset or drop existing tables. Confirm the migration status before and after
with `npx prisma migrate status`. Avoid `migrate reset` on any shared Neon
branch.

## Workload identity

Run development, staging, and production on separate Neon branches/databases.
Use a role scoped to the app database, and keep URLs in the deployment
platform's secret manager. Runtime URL should use the pooled host and TLS
(`sslmode=require`). For migration deployment use the direct host with a role
that can alter the schema. Rotate credentials if exposed, and do not paste
connection strings into chat or issue trackers.
