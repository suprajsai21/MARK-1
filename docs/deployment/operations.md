# Operations

## Cloudflare Tunnel deployment (nelctro.shop)

See [`nelctro-shop-cloudflare.md`](./nelctro-shop-cloudflare.md) for one-time setup.
For each production release:

1. Back up PostgreSQL and verify the backup file is non-empty before migrations.
2. Apply additive Prisma migrations using the deployment `DIRECT_DATABASE_URL`.
3. Deploy the API and web services with `docker compose up -d --build`.
4. Run `bash scripts/release/smoke.sh https://nelctro.shop` from a host with curl.
5. Confirm `GET /health/ready` is 200 and `/v1/links` returns 401 without a session.
6. Confirm requests preserve the Cloudflare client IP in API rate-limit logs/metrics.
7. If assets are stale, purge Cloudflare cache for `/` and static assets only; never
   cache `/v1/*` or `/health/*`.
8. Monitor Cloudflare Tunnel health and check Cloudflare WAF events for expected
   Razorpay deliveries to `/v1/webhooks/razorpay` (the webhook path must bypass
   browser challenge rules but remains authenticated by Razorpay signature).

The Tunnel is outbound-only; do not open ports 80/443/3000/5432 on the origin host.

## Deploy order

1. Run database migrations against the branch you are deploying to.
2. Deploy the API; confirm readiness before shifting traffic.
3. Deploy the web app against the API's stable URL.
4. Publish the extension build; users update on their own schedule, so the API
   must stay compatible with the previous extension release.

Never deploy the API before its migration. The reverse order is safe only when
the migration is additive.

## Health checks

- `GET /health/live` returns `200` once Fastify accepts requests. Use it for
  container liveness only.
- `GET /health/ready` runs a database query when a Prisma runtime is configured;
  otherwise this health handler returns `200` without a dependency probe. The
  production runtime configures Prisma, so readiness tests Neon connectivity.

Use `/health/live` for liveness and `/health/ready` for traffic routing and
post-deploy validation.

## Migrations

`packages/db/prisma/migrations` is the only source of schema change.

Run Prisma from `packages/db`, which pins Prisma 6.19 and holds the schema:

```bash
cd packages/db

# preview what will run (direct, non-pooled URL)
DATABASE_URL="$DIRECT_DATABASE_URL" npx prisma migrate status

# apply
DATABASE_URL="$DIRECT_DATABASE_URL" npx prisma migrate deploy
```

Do not run `npx prisma` from the repository root: it resolves a newer Prisma
release that rejects this schema, and it cannot find the schema path passed to
it.

Migrations are applied once per environment and must be reversible by a
follow-up migration, not by `migrate reset`. Never run `migrate reset` against a
branch holding payment or entitlement rows.

## Payment operations

Webhook deliveries are stored before processing, keyed by event ID, so retries
and duplicate deliveries are idempotent. When investigating a missing
entitlement:

1. Find the webhook event record by Razorpay event ID.
2. Check its processing status and any error captured at receipt.
3. Confirm the order's stored amount and currency match the captured payment.

Never grant entitlement by editing rows by hand. Replay the provider event
through the documented webhook path so the audit trail stays intact.

## Logging

- Log identifiers, event types, and outcomes. Never log API keys, session
  tokens, password hashes, or full provider payloads.
- Provider errors are normalized before logging so request headers cannot leak
  into error text.

## Backup and retention

Enable point-in-time restore on the production branch. Keep payment and audit
records beyond the retention required by your accountant or regulator; they are
not user-deletable content.

## Rotating secrets

Order matters for session and OAuth secrets:

1. Add the new value alongside the old.
2. Deploy.
3. Invalidate sessions issued under the old value.
4. Remove the old value.

For Razorpay keys, rotate the dashboard credential first, deploy the new pair,
then revoke the old key in the dashboard.
