# MARK-1 Implementation Plan Set

These plans translate the approved design in `../specs/2026-11-15-mark-1-browser-extension-design.md` into independently testable work packages. Implement in dependency order; foundation and payments must provide stable API contracts before extension integration. The browser extension can be developed against local fixtures while platform-independent backend work proceeds.

## Plans

1. [`2026-11-16-mark-1-foundation.md`](2026-11-16-mark-1-foundation.md) — workspace, shared contracts, database, customer authentication, email verification, generic account-link protocol, and customer/admin portal foundation.
2. [`2026-11-16-mark-1-payments.md`](2026-11-16-mark-1-payments.md) — one-time Razorpay orders, admin price controls, verified/idempotent webhook handling, purchases, refunds, and entitlements. Depends on foundation.
3. [`2026-11-16-mark-1-extension.md`](2026-11-16-mark-1-extension.md) — MV3 side panel, sign-in/entitlement gate, customer-owned Gemini key, explicit question review, local test fixture, and safe insertion behavior. Depends on shared contracts and auth/entitlement APIs.
4. [`2026-11-16-mark-1-launch-readiness.md`](2026-11-16-mark-1-launch-readiness.md) — authorized integration discovery, cross-component E2E/security checks, browser packages, operational docs, and release gates. Depends on the first three plans.

## External launch blockers

- The user reports that some authorized platform details are available, but the link method, approved v1 workflow behavior, and staging details are not in this repository. Real adapter work remains blocked until they are securely provided and verified.
- Email delivery, Razorpay test/production accounts, hosting/domain/TLS, and operational approvals require external configuration; no secrets belong in source control.
- Production deployment and browser-store publication require separate explicit approval.
