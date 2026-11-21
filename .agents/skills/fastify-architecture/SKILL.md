---
name: fastify-architecture
description: Guidelines and patterns for maintaining Fastify 5 modular plugins, route handlers, error wrappers, and health probes.
---

# Fastify Architecture Skill for MARK-1

## Modular Route Structure
- Routes are organized into feature modules under `apps/api/src/modules/`:
  - `auth`: Registration, Argon2id passwords, login, email verification, sessions.
  - `oauth`: Native OAuth 2.0 PKCE Authorization Server for browser extension.
  - `payments`: Razorpay order creation, verified HMAC webhooks, and customer entitlements.
  - `pricing`: Current product version pricing (`₹49` / 4900 paise).
  - `links`: Identity linking verification.
  - `admin`: Restricted admin endpoints.
- **Probes:**
  - `GET /health/live`: Unauthenticated liveness probe returning `{ status: "ok" }`.
  - `GET /health/ready`: Dependency readiness check querying database `SELECT 1` and verifying essential dependencies without leaking secrets.
