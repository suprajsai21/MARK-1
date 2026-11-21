# Security & Secret Management Rules

1. **Zero Secret Leakage:** Never output, print, or commit API keys, database connection strings with passwords, Razorpay secrets, or auth tokens.
2. **Environment Variables:**
   - Database: Always use `DATABASE_URL` with pooled connection (`-pooler`) for Fastify API runtime, direct connection for Prisma migrations in `packages/db`.
   - Email: Use `SMTP_URL` (with TLS in production: `smtps://` or `?secure=true`) and `EMAIL_FROM`. Do not invent Resend API keys.
   - Secrets: `LINK_SUBJECT_HMAC_SECRET` must be a high-entropy string (>= 32 chars).
3. **Authentication:**
   - Password hashing uses Argon2id with strict parameters.
   - Session tokens are stored in the database hashed.
   - Extension authentication utilizes standard OAuth 2.0 PKCE flow with authorization codes.
   - BYOK Gemini keys reside purely in client-side Chrome extension local storage; they never pass through MARK-1 API servers.
