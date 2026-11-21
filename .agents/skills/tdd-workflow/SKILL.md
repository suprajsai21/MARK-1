---
name: tdd-workflow
description: Enforce Test-Driven Development workflow across MARK-1 contracts, db, api, web, and extension packages.
---

# TDD Workflow Skill for MARK-1

## Purpose
Enforces rigorous test-driven development: write failing tests first, implement minimal code to satisfy the test, and verify regressions across the monorepo.

## Execution Steps
1. Identify the package under change (`packages/contracts`, `packages/db`, `apps/api`, `apps/web`, or `apps/extension`).
2. Write a unit/integration test reproducing the bug or defining the new requirement.
3. Run the targeted test:
   - For API: `corepack pnpm --filter @mark-1/api test -- <test-file>`
   - For Extension: `corepack pnpm --filter @mark-1/extension test -- <test-file>`
   - For Web: `corepack pnpm --filter @mark-1/web test -- <test-file>`
   - For DB: `corepack pnpm --filter @mark-1/db test -- <test-file>`
4. Confirm test failure for the expected reason.
5. Implement the minimal necessary change.
6. Re-run the test to confirm it passes.
7. Run the full workspace test suite: `corepack pnpm test`.
