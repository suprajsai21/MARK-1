# Security

## Threat model

The assets worth protecting are: user provider API keys, session and OAuth
tokens, password hashes, payment records, and entitlement state. The extension
runs in the user's own browser against sites the user is already signed into, so
it is treated as an untrusted client: it holds no server secrets and its
messages are not trusted input.

## Extension boundaries

- The extension is loaded only where the user invokes it. It holds no page
  permissions beyond the active tab it was invoked on.
- Provider API keys live in Chrome storage, are read only by the extension's own
  pages, and are never written to the DOM, page messages, analytics, or logs.
- Anything captured from a page is untrusted text. It is displayed for the user
  to review and is never executed or treated as an instruction.
- The extension never performs an action the user did not explicitly trigger.

## Auth

- Browser sign-in uses OAuth 2.0 authorization code with PKCE. The verifier
  never leaves the extension; only its S256 digest is sent.
- Authorization codes are single-use and short lived. Tokens rotate on refresh,
  and reuse of a rotated token revokes the family.
- Session cookies are `HttpOnly` and `SameSite=Lax`. The API adds the `Secure`
  attribute when request protocol is HTTPS (or trusted proxy headers indicate
  HTTPS). Server code compares passwords and payment signatures with
  timing-safe comparisons.
- Redirect URIs are matched exactly against a configured allowlist. No wildcard
  or prefix matching.

## Payments

- Razorpay signatures are verified over the raw request body before any state
  change. Verification failure returns an error and grants nothing.
- Amount and currency from the provider are compared against the stored order.
  A mismatch grants nothing and is recorded.
- Webhook event IDs are unique in the database, so retries and duplicates are
  ignored rather than double-applied.
- Price versions are immutable once created. Changing a price creates a new
  version; existing orders keep the snapshot they were created with.

## Input handling and rate limits

- Request bodies are validated by schemas before use. Validation rejects invalid
  values; whether unknown fields are rejected depends on the route schema.
- Fastify rate limiting can be enabled via server options. Configure and test
  limits at the edge for authentication, checkout, and webhook endpoints before
  go-live.
- Unknown webhook event types are recorded and returned without side effects.

## Error handling

Errors return a stable code and a message that describes the failure without
including credentials, connection strings, or stack traces. Provider error text
is normalized so headers and keys cannot reach the client.

## Review checklist before go-live

- [ ] No secret value appears in any client bundle.
- [ ] `RAZORPAY_WEBHOOK_SECRET` is set and the dashboard URL matches the route.
- [ ] OAuth allowlist contains only the real extension redirect URI.
- [ ] TLS is enforced end to end; the database connection uses `sslmode=require`.
- [ ] Rate limits are enabled in front of auth, checkout, and webhook routes.
- [ ] Any credential that was ever pasted outside the secret store is rotated.
