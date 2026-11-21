# Configuration

The API fails closed for database, origin, and email delivery configuration;
OAuth and Razorpay integrations remain unmounted unless their configuration is
present and valid. `HOST` and `PORT` are listener options, not security policy.

## Required for the API to start

| Variable | Purpose | Notes |
| --- | --- | --- |
| `DATABASE_URL` | PostgreSQL connection string | Use the Neon **pooled** connection string for the API; add `?sslmode=require`. |
| `WEB_ORIGIN` | Exact allowed browser origin for CORS and OAuth redirects | No trailing slash, e.g. `https://mark1.example.com`. |
| `EMAIL_FROM` | Verified sender address for auth emails | Required; the server refuses to start if missing or malformed. |
| `SMTP_URL` | SMTP transport connection URL | Required; store it in the host secret store. For Resend, use `smtp://resend:<URL_ENCODED_API_KEY>@smtp.resend.com:587` with `SMTP_SECURE=true` (STARTTLS), or port `465` for implicit TLS. |
| `PORT` | Listen port | Defaults to `3000`. Must be `1–65535`. |
| `HOST` | Listen address | Defaults to `0.0.0.0`. |

## Optional, must be paired

| Variable | Purpose | Failure mode |
| --- | --- | --- |
| `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` | Live Razorpay API calls | Setting only one throws `RAZORPAY_KEY_SECRET_REQUIRED` / `RAZORPAY_KEY_ID_REQUIRED`. |
| `RAZORPAY_WEBHOOK_SECRET` | Webhook signature verification | Requires a key pair. Without it, no webhook route is mounted and payment entitlements cannot be granted. |
| `OAUTH_CLIENT_ID` / `OAUTH_REDIRECT_URIS` | Extension authorization | Must both be set. Redirect URIs must be absolute `https:` URLs, comma separated, with no credentials, fragment, or query. |
| `LINK_SUBJECT_HMAC_SECRET` | Hashes external account identities | Account linking stays disabled while empty. Generate with `openssl rand -base64 32`. |

## Secret handling

- Keep every value in the hosting provider's secret store. Never commit `.env`;
  it is already git-ignored.
- The extension never receives provider keys. User API keys are held in Chrome
  storage and sent only to the provider the user chose.
- Rotate `SESSION_SECRET`, `LINK_SUBJECT_HMAC_SECRET`, and Razorpay credentials
  after any exposure. Treat any key pasted into chat, logs, or a ticket as
  compromised even in test mode.

## Database URLs

Neon exposes two strings per branch:

- **Pooled** (`-pooler` in the host) — use for the API at runtime.
- **Direct** — use only for `prisma migrate`, which needs a session connection.

Prisma reads a single `DATABASE_URL`. For migrations, point it at the direct
URL for that one command rather than storing two values. Run it from
`packages/db`, where the pinned Prisma CLI and schema live:

```bash
cd packages/db
DATABASE_URL="$DIRECT_DATABASE_URL" npx prisma migrate deploy
```

## Client-side configuration

The current API and extension code default to `http://localhost:3000` for local
development; update the extension API origin in source before producing a
production build. A production web API-base URL must be configured in the web
client when checkout integration is completed. The extension's OAuth client ID
must match the API's `OAUTH_CLIENT_ID`; do not assume production URLs are
configured just because an API deploy succeeds.
