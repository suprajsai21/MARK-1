---
name: code-reviewer
description: Review code diffs for security, lint compliance, architectural boundaries, and performance.
---

# Code Reviewer Skill for MARK-1

## Checklist
1. **Secrets:** Check that no credentials, tokens, or private URLs are committed.
2. **Types:** Run `corepack pnpm typecheck` and ensure no `any` leaks.
3. **Lint:** Run `corepack pnpm lint` and ensure clean output.
4. **Boundary Checks:** Verify `@mark-1/contracts` is used for shared schemas rather than ad-hoc types.
5. **Academic Safety:** Confirm no auto-solving or exam automation code is introduced.
