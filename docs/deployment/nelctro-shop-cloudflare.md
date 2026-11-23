# Deploying MARK-1 on nelctro.shop (Cloudflare Tunnel)

Cloudflare owns DNS, TLS, CDN, and WAF for `nelctro.shop`. The origin is a single
Linux host running `compose.yaml`. A **Cloudflare Tunnel** connects Cloudflare to
the web container, so **no inbound ports, public IPs, or origin certificates are
required**. This stays inside Cloudflare's free plan.

## Topology

```
Browser -> https://nelctro.shop -> Cloudflare edge (TLS, WAF, cache)
        -> Cloudflare Tunnel (cloudflared)
        -> web nginx (127.0.0.1:8080)
             /            -> SPA static files
             /v1/*        -> api:3000   (same-origin; no CORS)
             /health/*    -> api:3000
api:3000 -> db:5432   (Compose network only; never published publicly)
```

Why same-origin: `apps/web/src/api.ts` already calls `/v1/...` with
`credentials: 'include'`. Routing `/v1` through nginx on the same origin means no
CORS config, no cookie-domain split, and no change to the frontend.

## 1. Origin host prerequisites

- Linux host with Docker + Docker Compose v2.
- Outbound HTTPS allowed (required for the Tunnel and image pulls).
- No inbound ports opened in the firewall.

## 2. Configure environment (never commit this file)

Copy `.env.example` to `.env` on the host and set:

| Variable | Production value |
| --- | --- |
| `POSTGRES_PASSWORD` | long random secret |
| `DATABASE_URL` | `postgresql://mark1:<password>@db:5432/mark1?schema=public` |
| `WEB_ORIGIN` | `https://nelctro.shop` (exact origin, no path/trailing slash) |
| `TRUST_PROXY` | `1` |
| `SECURE_COOKIES` | `1` |
| `LINK_SUBJECT_HMAC_SECRET` | long random secret |
| `SMTP_URL`, `EMAIL_FROM` | production mail credentials |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_REDIRECT_URI` | `https://nelctro.shop/mail/callback` |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | production keys (set all three together) |

Notes:
- `TRUST_PROXY=1` makes the API read the real client IP from the single proxy hop.
  This is safe only because the API port is bound to loopback, so no direct
  internet client can forge forwarded headers.
- `SECURE_COOKIES=1` marks the session cookie `Secure`; browsers reach the app over
  HTTPS at Cloudflare, so this is correct even though nginx itself is HTTP.

Validate before deploying:

```bash
node scripts/release/check-env.mjs
docker compose config
```

## 3. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

Run database migrations against the deployed schema, then confirm readiness:

```bash
curl -fsS http://127.0.0.1:8080/healthz
curl -fsS http://127.0.0.1:8080/health/ready
```

## 4. Create the Cloudflare Tunnel

In the Cloudflare dashboard: **Zero Trust -> Networks -> Tunnels -> Create a tunnel**
(cloudflared). Add a public hostname:

| Field | Value |
| --- | --- |
| Subdomain | *(blank)* |
| Domain | `nelctro.shop` |
| Service | `http://localhost:8080` |

Run the connector on the origin host (install `cloudflared`, then
`cloudflared service install <token>`). No DNS record needs to be created by hand —
the tunnel route creates it.

## 5. TLS and WAF settings

- **SSL/TLS mode:** Full (strict) is not possible on a plain-HTTP origin unless you
  also install an Origin Certificate. With a Tunnel, Cloudflare terminates TLS and
  the tunnel is already encrypted end-to-end, so **Flexible is not needed** — keep
  the zone on Full and let the tunnel carry the encrypted hop.
- **TLS:** Cloudflare Tunnel encrypts the origin connection. Keep the zone on **Full (strict)** only when an HTTPS origin is configured; for the local HTTP Tunnel service, Cloudflare's edge still serves browser HTTPS and the Tunnel connection itself is encrypted. Avoid Flexible mode for direct-origin deployments because it does not provide end-to-end TLS. Verify login cookies are `Secure` and that login survives navigation.
- **Always Use HTTPS:** enable it after the Tunnel route is healthy. Enable HSTS only after confirming every required hostname is HTTPS.
- **Never cache API traffic.** Add a Cache Rule: if `URI Path starts with /v1/`
  then **Bypass cache**. Also bypass `/health/*`.
- **Allowlist the payment webhook.** Cloudflare Bot Fight Mode / managed challenges
  can block server-to-server webhooks. Add a WAF skip rule for
  `URI Path equals /v1/webhooks/razorpay` so Razorpay's signature check is what
  decides acceptance.
- **Enable "Always Use HTTPS"** and HSTS once the tunnel is verified.

## 6. Register the payment webhook

In Razorpay: webhook URL `https://nelctro.shop/v1/webhooks/razorpay`, same secret as
`RAZORPAY_WEBHOOK_SECRET`. Send a test event and confirm it is **not** challenged by
Cloudflare (check the WAF skip rule).

## 7. Post-deploy verification

```bash
bash scripts/release/smoke.sh https://nelctro.shop
```

Then confirm in a browser: register, verify email, log in, open checkout, and load
the portal over `https://nelctro.shop` with no mixed-content or cookie warnings.

## 8. Rollback

Tunnels and Compose make rollback cheap: `docker compose up -d --build` a previous
git tag, or point the tunnel hostname at a different local port. Database changes
are the only irreversible step — take a backup first (see `operations.md`).
