# Test-Driven Development & Code Quality Rules

1. **Test-First Discipline:**
   - Any new feature, route, or bugfix must be accompanied by automated unit or integration tests in Vitest.
   - Run tests before and after code changes using `corepack pnpm test`.
2. **Quality Gates:**
   - Zero linter errors or warnings: `corepack pnpm lint`.
   - Zero TypeScript errors: `corepack pnpm typecheck`.
   - All tests passing: 318+ tests must pass across all packages.
3. **Fail-Closed Integrations:**
   - External platform integrations (such as CodeTantra) must remain disabled in the registry until verified staging credentials and authorized test workflows exist.
