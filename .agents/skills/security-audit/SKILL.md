---
name: security-audit
description: Audit MARK-1 codebase for OWASP Top 10 vulnerabilities, credential exposures, CORS integrity, and signature verification.
---

# Security Audit Skill for MARK-1

## Audit Checklist
1. **Webhook Integrity:** All Razorpay webhooks must be verified using `crypto.createHmac('sha256', secret)` against raw body bytes before processing.
2. **CORS:** Ensure strict matching against configured `WEB_ORIGIN`; reject wildcard `*` origins for authenticated endpoints.
3. **Session Cookies:** Must use `SameSite=Strict`, `HttpOnly`, and `Secure` flags.
4. **Zero-Secret Leaks:** Audit logs, error handling, and test fixtures to ensure no credentials or raw tokens are emitted.
5. **BYOK Privacy:** Gemini API keys must remain strictly in extension client storage (`chrome.storage.local`) and never be transmitted to MARK-1 API.
