# MARK-1 Browser Extension Installation Guide

This document describes how to install, test, and distribute the MARK-1 browser extension across supported Chromium-based browsers (**Google Chrome**, **Microsoft Edge**, and **Brave**).

## Supported Browsers
- Google Chrome (Manifest V3)
- Microsoft Edge (Manifest V3)
- Brave Browser (Manifest V3)

> Note: Firefox is not supported in the initial v1 release.

---

## 1. Unpacked Development Installation (Sidepanel & Background)

For testing and local development:

1. Build the extension package:
   ```bash
   corepack pnpm build
   ```
2. The compiled unpacked extension will be located in:
   ```
   apps/extension/.output/chrome-mv3
   ```
3. Open your browser's extension management page:
   - **Chrome:** Navigate to `chrome://extensions/`
   - **Edge:** Navigate to `edge://extensions/`
   - **Brave:** Navigate to `brave://extensions/`
4. Toggle on **Developer mode** (usually in the top right or bottom left corner).
5. Click **Load unpacked**.
6. Select the folder: `apps/extension/.output/chrome-mv3`.
7. The **MARK-1 Extension** icon will now appear in your browser toolbar. Click it to open the Sidepanel.

---

## 2. Production Zip Packages

Pre-packaged release artifacts are built using:
```bash
corepack pnpm release:browser
```
This generates versioned `.zip` archives under `apps/extension/.output/browser-packages/`:
- `mark-1-extension-v1.0.0-chrome.zip`
- `mark-1-extension-v1.0.0-edge.zip`
- `mark-1-extension-v1.0.0-brave.zip`

---

## 3. Extension Configuration & First-Time Setup

1. **API Connection:**
   The extension connects to the configured MARK-1 API (default: `http://localhost:3000` or production domain).
2. **Account Sign-in (OAuth PKCE):**
   Click **Sign In** in the sidepanel. The extension launches `chrome.identity.launchWebAuthFlow` to authenticate with your MARK-1 account.
3. **Bring-Your-Own-Key (BYOK) Gemini:**
   - In the Sidepanel, open **Settings**.
   - Paste your personal Google Gemini API key.
   - The key is securely stored in `chrome.storage.local` on your local device. It is never transmitted to the MARK-1 backend servers.
