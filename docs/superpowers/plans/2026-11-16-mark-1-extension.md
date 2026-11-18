# MARK-1 Browser Extension Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Chromium extension shell and a safe, usable practice workflow with MARK-1 sign-in/entitlement checks, customer-owned Gemini keys, explicit question review, and verified insertion into supported controls.

**Architecture:** Use WXT with React and Manifest V3. Keep API keys and Gemini requests in the trusted extension service worker; content scripts only read/modify user-approved page controls after explicit action. Ship generic adapter contracts and a local fixture first; activate a real platform adapter only after authorized documentation and staging behavior are verified.

**Tech Stack:** WXT, React, TypeScript, Chromium Manifest V3, `chrome.storage`, Gemini API client, Vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-11-15-mark-1-browser-extension-design.md`, `docs/superpowers/plans/2026-11-16-mark-1-foundation.md`, and `docs/superpowers/plans/2026-11-16-mark-1-payments.md`

## Global Constraints

- Use **MARK-1** as the only product/project name.
- User-facing copy must say **Customer** or **User**, never “Teacher.”
- BYOK only; v1 supports Gemini and MARK-1 never pays model usage.
- The customer’s Gemini key and captured question content never go to MARK-1 services, analytics, or logs.
- Store the Gemini key only in extension-controlled storage accessible to trusted extension contexts; explain that browser-profile storage is not hardware-backed and may be exposed if a device/profile is compromised.
- Never place AI keys in content scripts, the DOM, page messages, analytics, logs, or crash reports.
- Show captured content for review/edit/removal before sending minimum necessary content directly to Gemini.
- Treat page text and Gemini output as untrusted; never execute generated code in the extension.
- Initial browser targets are Chrome, Edge, and Brave using Manifest V3; Firefox is later.
- Request host access only after opt-in to an approved integration and use least privilege.
- Coding and MCQ interactions are allowed only in explicitly authorized practice workflows; ambiguous modes stay manual.
- Submission remains manual by default; do not automate submission until the exact practice workflow is verified as permitted.
- Never claim hidden tests ran or submission succeeded without observable evidence.

## Review Focus

- Key storage must be inaccessible to page content scripts and absent from all MARK-1 requests; pin in `storage.keyIsTrustedContextOnly` and `network.geminiRequestNeverCallsMark1Api` (Task 3).
- Prompt-injected page text must remain quoted data and cannot trigger tool/DOM actions; pin in `questionReview.treatsPageTextAsUntrustedData` (Task 4).
- Invalid key, quota exhaustion, network error, and provider rejection must produce accurate recoverable UI states; pin in `gemini.generateReportsProviderErrorsWithoutLeakingKey` (Task 3).
- Stop/pause/resume during typing must not duplicate or corrupt editor contents; pin in `typing.stopAndResumePreserveExactTargetText` (Task 5).
- Unsupported editor, missing host permission, and unknown assessment mode must disable page mutation and submission; pin in `adapters.unsupportedPageIsReadOnly` and `practice.unknownModeNeverSubmits` (Tasks 2, 5, and 6).
- Unavailable or unobservable test results must be shown as unavailable, never inferred as a pass; pin in `testResults.onlyReportsObservedEvidence` (Task 6).

---

## File Map

- `apps/extension/wxt.config.ts`, `apps/extension/manifest.ts`: MV3 entry points, side panel, least-privilege optional host permissions.
- `apps/extension/src/entrypoints/background.ts`: trusted service-worker message router and provider/key operations.
- `apps/extension/src/entrypoints/sidepanel/`: Customer UI and workflow state.
- `apps/extension/src/entrypoints/content.ts`: opt-in capture/insertion bridge; no credentials or provider key access.
- `apps/extension/src/auth/`: PKCE-based extension sign-in and entitlement retrieval.
- `apps/extension/src/provider/gemini.ts`: direct customer-key Gemini adapter.
- `apps/extension/src/platform/`: generic registry, question/editor/test-result contracts, reusable editor adapters, and test fixture; real platform mappings stay disabled until authorized details are provided.

## Task 1: MV3 extension shell and least-privilege permissions

**Files:**
- Modify: `apps/extension/package.json` (initialized in the foundation plan)
- Create: `apps/extension/wxt.config.ts`, `apps/extension/manifest.ts`
- Create: `apps/extension/src/entrypoints/background.ts`, `apps/extension/src/entrypoints/sidepanel/index.html`, `apps/extension/src/entrypoints/sidepanel/main.tsx`, `apps/extension/src/entrypoints/sidepanel/App.tsx`
- Test: `apps/extension/src/__tests__/manifest.test.ts`, `apps/extension/src/entrypoints/sidepanel/__tests__/App.test.tsx`

**Interfaces:**
- Package `@mark-1/extension` builds Chromium MV3 packages for Chrome, Edge, and Brave.
- Initial side-panel states: `signedOut`, `noEntitlement`, `ready`, `questionReview`, `generating`, `answerReview`, `error`.

- [ ] **Step 1: Write failing tests** for manifest version, side-panel entry, no `<all_urls>` required permission, no default host grants, and Customer/User-only copy.
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- manifest`; confirm the tests fail before setup.**
- [ ] **Step 3: Create the WXT/React MV3 shell.** Declare only `sidePanel`, `storage`, `identity`, and `scripting` APIs required by the implementation; use optional host permissions and dynamically register content scripts for an exact configured origin only after the customer opts into an approved integration. Do not require `<all_urls>` or a real domain in the generic manifest.
- [ ] **Step 4: Run `pnpm --filter @mark-1/extension test -- manifest && pnpm --filter @mark-1/extension build`; confirm manifest tests and build pass.**

## Task 2: Extension sign-in, entitlement gate, and generic adapter contracts

**Files:**
- Create: `apps/extension/src/auth/{pkce,client,session}.ts`
- Create: `apps/extension/src/platform/{types,registry,permissions}.ts`
- Modify: `packages/contracts/src/extension.ts` and `packages/contracts/src/index.ts`
- Test: `apps/extension/src/{auth,platform}/__tests__/*.test.ts`

**Interfaces:**
- `ExtensionAuth.signIn(): Promise<void>` uses `chrome.identity.launchWebAuthFlow`, PKCE S256, and the authenticated web consent flow (`GET/POST /v1/oauth/authorize`, `POST /v1/oauth/token`) to exchange a one-time authorization code.
- `ExtensionAuth.getEntitlement(): Promise<{ active: boolean; productVersionId?: string }>` calls the API using the short-lived bearer token.
- `PlatformAdapter`: `{ id: string; supports(url: URL): boolean; extractQuestion(): Promise<QuestionDraft | null>; getEditor(): Promise<EditorAdapter | null> }`
- `EditorAdapter`: `read(): Promise<string>; replace(text: string, signal: AbortSignal): Promise<void>`

- [ ] **Step 1: Write failing tests** for PKCE state/verifier validation, one-time code handling, entitlement-gated ready state, exact-origin permission prompt, and registry rejection of an unapproved integration.
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- auth platform`; confirm the new tests fail.**
- [ ] **Step 3: Implement extension sign-in using a short-lived authorization code and PKCE.** The extension never collects a MARK-1 password; refresh tokens are rotated, revocable, and stored only in trusted extension storage. Configure `chrome.storage.local` access as `TRUSTED_CONTEXTS` before saving secrets.
- [ ] **Step 4: Implement entitlement checks and generic adapter interfaces.** No real target domain or adapter is bundled at this stage; unsupported pages remain read-only.
- [ ] **Step 5: Run `pnpm --filter @mark-1/extension test -- auth platform`; confirm all tests pass.**

## Task 3: Trusted Gemini BYOK settings and direct generation

**Files:**
- Create: `apps/extension/src/provider/{gemini,provider-types}.ts`
- Create: `apps/extension/src/background/{message-router,secret-store}.ts`
- Create: `apps/extension/src/entrypoints/sidepanel/features/settings/{GeminiSettings,KeyStatus}.tsx`
- Test: `apps/extension/src/provider/__tests__/gemini.test.ts`, `apps/extension/src/background/__tests__/secret-store.test.ts`

**Interfaces:**
- `GeminiProvider.generate(input: { apiKey: string; question: string; signal: AbortSignal }): Promise<{ answer: string }>`
- `GeminiProvider.validateKey(apiKey: string): Promise<{ valid: boolean; reason?: "invalid" | "quota" | "network" | "provider" }>`
- `SecretStore.setGeminiKey(key: string): Promise<void>`
- `SecretStore.getGeminiKey(): Promise<string | null>`
- `SecretStore.deleteGeminiKey(): Promise<void>`

- [ ] **Step 1: Write failing tests** for local key save/validate/replace/delete, service-worker-only access, direct Gemini request, abort behavior, and invalid-key/quota/network errors.
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- provider secret-store`; confirm tests fail before implementation.**
- [ ] **Step 3: Implement the Gemini REST adapter and settings UI.** Send requests from the trusted service worker directly to the currently supported stable Gemini model; send the key only in the provider API-key header, never in a URL, and never call the MARK-1 API with the key or question. Key validation is a customer-triggered action and must explain provider billing before making a validation request. Redact the key from errors/logs and disclose browser-profile storage limitations in settings.
- [ ] **Step 4: Run `pnpm --filter @mark-1/extension test -- provider secret-store`; confirm all cases pass.**

## Task 4: Explicit question preview and answer review workflow

**Files:**
- Create: `apps/extension/src/entrypoints/content.ts`, `apps/extension/src/platform/question-capture.ts`
- Create: `apps/extension/src/entrypoints/sidepanel/features/workflow/{WorkflowPanel,QuestionReview,AnswerReview}.tsx`
- Create: `apps/extension/src/platform/fixtures/PracticeFixture.tsx`
- Test: `apps/extension/src/platform/__tests__/question-capture.test.ts`, `apps/extension/src/entrypoints/sidepanel/features/workflow/__tests__/workflow.test.tsx`

**Interfaces:**
- `QuestionDraft`: `{ prompt: string; choices?: Array<{ id: string; text: string }>; source: "user-selected" | "approved-adapter" }`
- `WorkflowController.start(): Promise<QuestionDraft | null>` requires an explicit side-panel action.
- `WorkflowController.generate(draft: QuestionDraft, signal: AbortSignal): Promise<{ answer: string }>` runs only after preview confirmation.

- [ ] **Step 1: Write failing tests** for no capture before explicit start, editable/removable preview, no API/backend request, abort while generating, and page text treated as data rather than instructions.
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- workflow question-capture`; confirm failures before implementation.**
- [ ] **Step 3: Implement side-panel state transitions and a local practice fixture.** Capture only minimum visible question text, show it before generation, allow edits/removal, warn customers to remove identifying details (without claiming perfect automatic PII detection), and require a second explicit action to send to Gemini. Do not persist question or answer after the workflow.
- [ ] **Step 4: Run `pnpm --filter @mark-1/extension test -- workflow question-capture`; confirm tests pass.**

## Task 5: Reusable editor adapters and verified typing controls

**Files:**
- Create: `apps/extension/src/platform/editors/{textarea,monaco,code-mirror-5,code-mirror-6,ace,typing-controller}.ts`
- Create: `apps/extension/src/platform/fixtures/editors/{Textarea,Monaco,CodeMirror5,CodeMirror6,Ace}.tsx`
- Create: `apps/extension/src/entrypoints/sidepanel/features/workflow/InsertControls.tsx`
- Test: `apps/extension/src/platform/editors/__tests__/*.test.ts`, `apps/extension/src/platform/fixtures/editors/__tests__/*.spec.ts`

**Interfaces:**
- `TypingController.start(input: { editor: EditorAdapter; text: string; intervalMs: number }): Promise<void>`
- `TypingController.pause(): void`, `resume(): void`, `stop(): void`
- `EditorRegistry.detect(root: Document): Promise<EditorAdapter | null>` returns `null` for unsupported or ambiguous controls.

- [ ] **Step 1: Write failing tests** for textarea, Monaco, CodeMirror 5/6, and Ace read/replace; instant/paced insertion; speed bounds; pause/resume/stop; exact final content verification; no duplicate insertion on retry; and unsupported editor refusal.
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- editors`; confirm adapter and typing tests fail before implementation.**
- [ ] **Step 3: Implement adapters and fixture-based browser tests.** Keep provider keys and account tokens in the trusted service worker; page-world bridges may receive only the user-approved question/answer action payload, never credentials. Require exact final editor content equality before showing success. Do not register any editor adapter for a real platform until it passes on authorized staging pages.
- [ ] **Step 4: Run `pnpm --filter @mark-1/extension test -- editors && pnpm --filter @mark-1/extension build`; confirm tests and build pass.**

## Task 6: Practice-only MCQ and observable test-result handling

**Files:**
- Create: `apps/extension/src/platform/{mcq/selection-controller.ts,test-results/types.ts,test-results/controller.ts,practice-policy.ts}`
- Create: `apps/extension/src/entrypoints/sidepanel/features/workflow/{ChoiceReview,TestResults}.tsx`
- Test: `apps/extension/src/platform/{mcq,test-results}/__tests__/*.test.ts`, `apps/extension/src/platform/__tests__/practice-policy.test.ts`

**Interfaces:**
- `PracticePolicy.canMutate(input: { integrationApproved: boolean; verifiedPracticeContext: string | null; customerConfirmedPractice: boolean; permittedAction: "insert" | "select" | "submit" }): boolean`
- `PlatformTestResultsAdapter.runAvailableTests(signal: AbortSignal): Promise<Array<{ label: string; status: "passed" | "failed" | "running" | "unknown"; observedText: string }>>`
- `PlatformTestResultsAdapter` returns only test output visibly exposed through a verified, permitted workflow; absent results are represented as unavailable, never as a pass.

- [ ] **Step 1: Write failing tests** for normal-control MCQ selection with visible confirmation, denied behavior when practice context is unknown, no automatic submission, aborting tests, and showing only observed test results (including unavailable/unknown states).
- [ ] **Step 2: Run `pnpm --filter @mark-1/extension test -- mcq test-results practice-policy`; confirm these tests fail before implementation.**
- [ ] **Step 3: Implement MCQ and test-result adapters behind the approved integration registry.** Do not treat a URL or DOM flag alone as proof of an authorized practice workflow; require verified workflow evidence plus explicit customer confirmation. Keep submission manual for v1. Never claim hidden test access or submission success.
- [ ] **Step 4: Run `pnpm --filter @mark-1/extension test -- mcq test-results practice-policy && pnpm --filter @mark-1/extension build`; confirm all tests/build pass.**

## Completion Gate

A real platform adapter, real editor support, and any submission behavior remain blocked until the authorized platform's linking/workflow documentation and staging environment are verified. The local fixture proves extension mechanics only; it does not prove real-site permission or compatibility.
