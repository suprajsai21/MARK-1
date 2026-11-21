---
name: release-packaging
description: Automated validation and artifact packaging for Docker containers, web bundles, and browser extensions.
---

# Release Packaging Skill for MARK-1

## Build & Release Verification
1. **Pre-flight Check:**
   - Run `node scripts/release/check-env.mjs` to ensure required environment variables are set.
2. **Build Sequence:**
   - Execute sequential monorepo build: `corepack pnpm build`.
3. **Browser Extension Packages:**
   - Execute `corepack pnpm release:browser`.
   - Produces versioned `.zip` artifacts for Chrome, Edge, and Brave under `apps/extension/.output/browser-packages/`.
4. **Container Artifacts:**
   - API container: `docker build -f apps/api/Dockerfile .`
   - Web container: `docker build -f apps/web/Dockerfile .`
