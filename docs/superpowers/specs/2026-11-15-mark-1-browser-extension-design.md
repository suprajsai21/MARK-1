# MARK-1 Browser Extension and Learning-Platform Integration — Design

**Status:** Approved for planning and implementation on 2026-11-16 — no product code implemented
**Date:** 2026-11-15
**Product name:** MARK-1
**User-facing account label:** Customer/User

## Intent

Build a production-ready browser extension and the MARK-1 services needed to sell and operate it. The extension helps a paid Customer/User work with coding and MCQ questions in an authorized learning website. After the user starts a workflow, the extension detects and previews the question, generates an answer through the user’s own AI API key, enters it into a supported editor or option control, displays available test results, and supports submission only in an explicitly permitted practice workflow.

MARK-1 provides its own customer login, one-time payment checkout, admin price/access controls, and one-to-one account linking to an authorized Target Learning Platform. The platform’s question library is not being rebuilt. User-facing copy must say **Customer** or **User**, never “Teacher.”

## Decisions from the conversation

- Use **MARK-1** as the only product/project name.
- AI is **BYOK only**. MARK-1 never pays for model usage. The customer supplies a provider key and pays that provider directly.
- Version one supports **Gemini**. Keep a provider-adapter boundary so additional customer-key providers can be added later.
- Build MARK-1’s own login and payment system. Keep the existing learning website in place and link to its account securely.
- Enforce one MARK-1 account ↔ one linked learning-platform account. Never collect or store the external website password or session cookies.
- Sell in **India through Razorpay using a one-time payment**, not a recurring subscription. Admins control the price.
- Initial browser targets: **Chrome, Edge, and Brave**. Firefox may follow later.
- The supplied GitHub repository is `https://github.com/suprajsai21/MARK-1.git`; it currently contains only a README and no application code.
- Use generic integration language in code and documents. Refer to an external site only as **Target Learning Platform**, **Supported Website**, **Institution Portal**, or **Learning Platform**. Never hardcode real institution/vendor names, domains, tenant subdomains, emails, or contacts.

## Users and roles

- **Customer/User:** creates a MARK-1 account, links one authorized learning-platform account, makes a one-time purchase, provides a Gemini key, and uses the extension.
- **MARK-1 admin:** manages product price and access entitlements; cannot view AI keys or captured question content.
- **Target Learning Platform:** remains the source of the external account identity and question/editor pages. Its exact identity, linking capability, and supported workflows must be verified using authorized access before integration work.

## Product scope

### In scope

1. Chromium browser extension with a persistent side panel.
2. MARK-1 customer portal and authentication.
3. Secure one-to-one linking to an authorized learning-platform account.
4. Razorpay one-time payment checkout, verified webhooks, purchase records, entitlements, and admin-managed pricing.
5. BYOK Gemini configuration and direct requests from the extension.
6. Generic, modular learning-platform adapters for question detection, editors, MCQs, tests, and permitted practice submission.
7. Automated tests, local development setup, deployment documentation, and browser release packaging.

### Not in scope

- Rebuilding the Target Learning Platform’s question library or course website.
- Company-funded AI API usage or pooled company keys.
- Guaranteed compatibility with every site/editor on the internet.
- Bypassing site policies, access controls, anti-automation checks, CAPTCHAs, or restricted assessments.
- Claiming hidden tests ran or submission succeeded without observable evidence.
- Hardcoding any actual institution, vendor, or third-party learning-site identity.

## Proposed architecture

A single MARK-1 repository can contain separate, independently testable applications:

- `apps/extension`: TypeScript browser extension (Manifest V3), side panel, trusted background/service worker, and page content scripts.
- `apps/web`: MARK-1 sign-in, account-linking, one-time checkout, and admin portal.
- `apps/api`: authenticated API for MARK-1 accounts, one-to-one links, payment orders/webhooks, product prices, and access entitlements.
- `packages/shared`: validated contracts/types shared by the extension, web app, and API.
- PostgreSQL: MARK-1 accounts, unique platform links, purchase records, pricing versions, entitlements, and audit events. Do not store page content, external credentials, or AI keys here.
- `apps/extension/src/adapters/platforms`: separately configurable adapters for each approved learning platform; no real domain or institution identity in generic core code.

**Proposed stack:** TypeScript across extension and web/API services, React for extension UI, Node.js API, PostgreSQL, and Razorpay’s supported server-side integration. This is a proposed call for approval; the supplied repository currently has no application stack.

The API is authoritative for purchase entitlements. A browser return page must never grant access on its own; only verified Razorpay payment events may do so. One-time purchase records and entitlement updates must be idempotent.

## Account, linking, and one-time payment workflow

1. The customer creates a MARK-1 account and verifies control of their email.
2. The customer links one external account using a short-lived, single-use authorization challenge. Prefer an official identity API or signed/OAuth-style flow. If the Target Learning Platform lacks one, a minimal approved link endpoint or other authorized verification mechanism is required. Never ask for its password or copy its cookies.
3. A server-side unique constraint enforces one MARK-1 account ↔ one linked account for each integration. Unlink/relink actions require re-verification, are audited, and follow an admin-configurable transfer/cooldown policy. Do not bind licenses permanently to a single computer.
4. The customer selects the current MARK-1 product price and pays once through Razorpay-hosted checkout. MARK-1 stores payment/provider IDs and status, not card details.
5. The backend verifies Razorpay signatures and webhook events before granting access. Duplicate/replayed events must be safe. Failed payments grant no entitlement; a verified refund or chargeback revokes the associated entitlement.
6. **Proposed entitlement default for approval:** one successful purchase grants continuing access to the purchased product version without recurring renewal; a refund or chargeback revokes it. Admin price changes apply to new purchases and do not silently alter prior purchases.
7. The extension signs in to MARK-1 and checks the current entitlement. It does not receive or use external website passwords or session cookies.

Razorpay transaction fees, hosting, email, and other operating expenses are separate from AI usage. BYOK removes MARK-1-funded model inference costs; it does not remove payment-processing or infrastructure costs.

## BYOK AI workflow

- V1 provider: Gemini only. Future providers require named adapters and explicit approval; provider keys and request formats are not interchangeable.
- The customer can add, validate, replace, or delete their Gemini key in extension settings.
- The extension’s trusted service worker sends requests directly to Google’s Gemini API. The MARK-1 backend never receives the key or prompt.
- Keep the key out of page content scripts, DOM, analytics, logs, crash reports, and GitHub. Store it only in extension-controlled browser storage accessible to the trusted extension context. Explain that browser-profile storage is not a hardware-backed vault and can be exposed if the device/profile is compromised.
- Google bills the customer’s key/account directly. Show clear errors for invalid keys, quota exhaustion, network errors, and provider failures.
- A provider abstraction may be prepared for future BYOK providers, but do not implement managed keys or company-paid AI calls.

## Customer workflow in the extension

1. The user opens an authorized supported page and explicitly starts a workflow.
2. The selected platform adapter detects supported question content and displays it in the side panel. The user can edit/remove unnecessary or identifying information before generation.
3. Send only the reviewed minimum question content directly to Gemini. Do not persist page content or send it to MARK-1 services. Treat page text as untrusted data and defend against prompt injection.
4. Display the generated answer for review.
5. **Coding questions:** generate a complete code solution. Support standard textareas and common Monaco, CodeMirror 5/6, and Ace editors when verified. Offer instant insertion or paced character-by-character typing, adjustable speed, pause, resume, and immediate stop. Verify exact final editor content; detect incomplete, duplicated, or corrupted insertion.
6. **MCQ/multi-select:** show proposed choices, then select through normal page controls in authorized practice workflows and visibly confirm selection.
7. For coding questions, run tests/results explicitly exposed by the Supported Website through permitted controls. Display available evidence; do not claim hidden data or tests were accessed.
8. Submission remains manual by default. Optional automation must be off by default, explicitly enabled, and restricted to a verified, authorized practice workflow where the site permits it. If tests fail, permission is unclear, or the page is unsupported, do not submit.
9. Stop cancels pending typing and submission actions. Repeated actions must not duplicate text or submit twice.

## Generic integration and browser behavior

- Initial release: Chrome, Edge, and Brave using Chromium extension APIs and Manifest V3 where supported. Firefox is a later port, not a v1 promise.
- Keep browser-specific APIs behind an adapter boundary.
- Use a configurable integration registry with approved domain patterns, platform identifier, question extraction rules, editor adapters, test-result behavior, permitted interaction modes, version, and compliance restrictions.
- Request host access only when the user opts in to an approved integration. Use least-privilege permissions and support authorized iframe contexts only where required.
- Generic selectors and domain examples in documentation must use placeholders such as `https://<platform-domain>`; do not store real external domains or institution identifiers in generic docs or code.
- Do not promise compatibility with every website. Report unsupported editors, inaccessible questions, unavailable tests, and blocked actions clearly.
- A page URL or DOM flag alone is not definitive proof that automation is allowed. Unknown or ambiguous assessment modes default to non-automating/manual review.

## Security, privacy, and policy requirements

- Customer/User terminology only in product UI and user-facing messages.
- Never collect external passwords, session cookies, private tokens, browser history, or unrelated profile information.
- BYOK keys and captured question content never go to MARK-1 backend, analytics, or logs.
- Show captured content before sending; send only the minimum user-reviewed content to Gemini; do not retain it after the request. Warn users to remove personal information. Do not claim perfect automatic PII detection.
- Treat page text and Gemini output as untrusted. Do not execute generated code in the extension. Insert only into the intended supported editor after user review; tests run through the authorized page workflow.
- Enforce account linking, one-to-one uniqueness, payment verification, entitlements, and admin permissions server-side.
- Do not implement stealth, anti-detection, or policy-circumvention behavior.
- Use provider privacy settings only where verified for the specific API/product; do not claim zero-data-retention without evidence.

## Approaches considered

### A. New MARK-1 login/payment services plus secure link to the existing learning website — selected

Build the extension, MARK-1 account portal/API, Razorpay one-time checkout, entitlement service, and generic platform adapters. Link the existing learning account through a verified, short-lived flow. This supports the requested stand-alone MARK-1 purchase while leaving the question library in place.

Trade-off: account linking and real-site tests require an approved linking mechanism and an authorized test environment. The supplied GitHub repository does not contain that integration.

### B. Reuse the existing learning website’s account and payment system — not selected

This would duplicate less functionality, but conflicts with the decision to build MARK-1’s own login and one-time Razorpay payment.

### C. Rebuild the learning website and its question library — not selected

This unnecessarily expands the product scope; the existing learning site remains in place.

### AI choices

- **BYOK direct Gemini — selected:** the customer pays Google; MARK-1 does not pay model usage. Key and prompt stay out of MARK-1 services.
- **MARK-1-managed provider keys — rejected:** this would make MARK-1 responsible for AI usage costs and contradict the BYOK-only decision.

## Implementation sequencing

**Selected direction (2026-11-16): prerequisites-first staged delivery.** The user chose to validate the authorized platform integration and key business rules before committing the implementation sequence. The user also decided that unresolved platform details block only site-specific adapter work, not platform-independent product work.

**Decisions confirmed for planning:** use the proposed TypeScript monorepo with React extension UI, Node.js API, and PostgreSQL; a one-time purchase grants continuing access to the purchased product version, and verified refunds or chargebacks revoke that entitlement. These decisions are recorded as confirmed for planning; external platform-link and v1 workflow details remain launch dependencies.

**Discovery gate and open dependency:** the user reports that some authorized platform details are available and can be provided through a secure channel. Before adapter implementation, verify the approved account-linking mechanism, specific v1 practice workflows, relevant question/editor/test-result/submission behaviors, and authorized staging access. Keep real domains, credentials, and account details out of this repository and ordinary chat. Until those details are verified, keep site-specific integration work blocked and do not claim compatibility or permission. The exact workflow and test pages remain open dependencies for the plan.

The staged order is: (0) discovery/approval of platform requirements and secure test access; (1) establish the TypeScript monorepo, shared contracts, and automated checks; (2) implement MARK-1 account, email-verification, linking, pricing, and entitlement foundations; (3) add Razorpay test-mode checkout, verified/idempotent webhooks, refund handling, and admin price controls; (4) build the Chromium extension shell with MARK-1 sign-in, entitlement checks, and local Gemini BYOK; (5) implement the first approved platform adapter, editor/MCQ interactions, observable test-result display, and only the permitted practice-workflow behavior; (6) complete privacy/security and end-to-end verification, browser packaging, and deployment documentation. Once the discovery gate has run, platform-independent work may proceed even if site-specific details remain unavailable. Production deployment or browser-store publication requires separate explicit approval.

**Other sequencing considered:** an extension-first demo could provide earlier UI feedback, but risks producing a throwaway integration disconnected from confirmed platform permissions; a backend-first sequence could validate account and payment foundations early, but would defer discovery of the platform-link dependency. Prerequisites-first was chosen to expose the highest-impact external assumptions early while allowing platform-independent work to continue after discovery.

## Acceptance criteria

- The extension, customer portal, API, database, and Razorpay one-time payment integration are separate, testable components in the MARK-1 repository.
- A customer can create a MARK-1 account, verify email, securely link exactly one authorized learning-platform account, pay once through Razorpay, and use extension features only with a valid entitlement.
- Payment webhook signatures are verified before access is granted; replayed/duplicate events are idempotent.
- Admin can set the price for new purchases; MARK-1 does not store card details. Refunded/charged-back purchases lose entitlement.
- Gemini requests use the customer’s key directly from the extension. No AI usage is billed to MARK-1, and no key/question content reaches MARK-1 servers or logs.
- User-facing UI consistently says Customer/User, never Teacher; generic integration code/docs contain no identifying third-party platform names/domains.
- The user can review/edit captured question text and generated answer before insertion.
- Paced typing and instant insertion work on supported controls; paced typing has speed/pause/resume/stop and exact final-content verification.
- MCQ choices are visibly selected through normal controls in authorized workflows.
- Available tests and outcomes are displayed; failed tests, unknown permission, or unsupported pages prevent auto-submit.
- Auto-submit is off by default and only works for explicitly approved, permitted practice workflows.
- Invalid key, exhausted quota, invalid/failed/refunded payment, unsupported editor, lost connection, partial insertion, and stop/cancel behavior are handled without false success claims.
- No secrets or captured page content appear in GitHub, analytics, or service logs.

## Build and verification sequence

1. Audit the supplied MARK-1 repository and verify its ownership/access. It currently contains only a README.
2. Obtain the authorized Target Learning Platform’s generic integration requirements, approved URL patterns through a secure configuration channel, link/API documentation, representative practice pages, and a staging/test account. Do not place real domains or institution identifiers in generic source/docs.
3. Define and test the secure one-to-one link protocol; confirm that the platform team authorizes any required endpoint or identity flow.
4. Implement MARK-1 auth, email verification, account-linking, product-price, and entitlement data models.
5. Implement Razorpay one-time checkout, verified webhooks, purchase/refund/chargeback handling, admin price controls, and replay/failure tests.
6. Implement the Chromium extension shell, MARK-1 sign-in, entitlement check, local BYOK Gemini settings, and side panel.
7. Implement generic adapter interfaces and the first authorized platform adapter; add question preview, editor/MCQ adapters, paced/instant insertion, verification, test-result display, and permitted submission flow.
8. Run unit, integration, extension-build, privacy/security, and end-to-end tests. Package Chrome/Edge/Brave builds and document installation, support limits, privacy, and BYOK key handling.
9. Request explicit approval before production deployment or browser-store publication. Do not report proposed items as implemented until verified.

## Dependencies and items to inspect later

- Authorized Target Learning Platform URL/source or API documentation and a safe staging/test account for account-linking and page-adapter testing. Keep actual identifying information out of generic documentation and source code.
- Company-controlled GitHub access for the supplied MARK-1 repository before any remote push.
- Email delivery service for account verification and linking notifications; choose during implementation planning.
- Razorpay account and test-mode credentials, provided securely through environment configuration and never committed to GitHub.
- Business approval of the proposed continuing-access entitlement for a one-time purchase and refund/chargeback revocation rule.
