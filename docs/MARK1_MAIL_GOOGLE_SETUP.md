# MARK-1 MAIL — Google Cloud & OAuth 2.0 Setup Guide

Phase 1 of **MARK-1 MAIL** integrates multi-account Gmail authorization using OAuth 2.0 PKCE and authenticated AES-256-GCM token encryption at rest.

---

## 1. Google Cloud Console Configuration

To authorize Gmail accounts, you will need a Google Cloud project with OAuth 2.0 credentials configured as follows:

### Step 1: Create or Select a Google Cloud Project
1. Open the [Google Cloud Console](https://console.cloud.google.com/).
2. Create a new project (e.g., `mark-1-mail-prod` or `mark-1-dev`) or select an existing one.

### Step 2: Enable the Gmail API
1. In the navigation menu, go to **APIs & Services** > **Library**.
2. Search for **Gmail API**.
3. Click **Enable**.

### Step 3: Configure the OAuth Consent Screen
1. Go to **APIs & Services** > **OAuth consent screen**.
2. Select User Type:
   - **Internal** (if connecting Google Workspace accounts within your organization)
   - **External** (if connecting standard `@gmail.com` accounts or cross-organization accounts)
3. App name: `MARK-1`
4. User support email: Select your admin email.
5. Developer contact information: Enter your contact email.
6. Scopes requested (**Minimal Phase 1 Scopes Only**):
   - `openid`
   - `https://www.googleapis.com/auth/userinfo.email`
   - `https://www.googleapis.com/auth/userinfo.profile`
   - `https://www.googleapis.com/auth/gmail.readonly` (Read-only access)
   > [!IMPORTANT]
   > Do NOT request `https://www.googleapis.com/auth/gmail.send`, `https://mail.google.com/`, or other write/send scopes in Phase 1.
7. Test users (if using External in Testing mode):
   - Add the Gmail addresses you intend to authorize during testing.

### Step 4: Create OAuth 2.0 Client Credentials
1. Go to **APIs & Services** > **Credentials**.
2. Click **Create Credentials** > **OAuth client ID**.
3. Application type: **Web application**.
4. Name: `MARK-1 Mail Web Client`.
5. Authorized JavaScript origins:
   - `http://localhost:5173` (development)
   - Your production web origin (e.g. `https://app.yourdomain.com`)
6. Authorized redirect URIs:
   - `http://localhost:5173/mail/callback` (development)
   - Your production callback URL (e.g. `https://app.yourdomain.com/mail/callback`)
7. Click **Create**.
8. Copy the generated **Client ID** and **Client Secret**.

---

## 2. Environment Variables Configuration

In your `.env` file (copied from `.env.example`), provide:

```env
# 32-byte authenticated AES-256-GCM encryption key (64 hex characters)
# Generate with: openssl rand -hex 32
MAIL_TOKEN_ENCRYPTION_KEY=your_64_character_hex_key

# Google OAuth 2.0 Web Client credentials
GOOGLE_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-google-client-secret
GOOGLE_REDIRECT_URI=http://localhost:5173/mail/callback
```

---

## 3. Security Architecture Highlights

1. **Authenticated Encryption at Rest:**
   - All OAuth access tokens and refresh tokens are encrypted using **AES-256-GCM** before database storage.
   - Each token encryption uses a unique, cryptographically random 12-byte IV and a 16-byte authentication tag.
   - Keys are validated on startup (strictly 32 bytes required; fails closed if missing in production).

2. **Zero Token Exposure:**
   - Encrypted tokens are isolated in the `MailOAuthCredential` table and are strictly decrypted only on the backend when communicating with Google APIs.
   - Frontend API responses only ever return public metadata (email, display name, avatar, status, timestamps, scopes). No access/refresh tokens are ever returned or stored in cookies/localStorage.

3. **CSRF & PKCE Defense:**
   - Every connection authorization uses SHA-256 PKCE (`code_challenge` / `code_verifier`).
   - Every authorization state is cryptographically generated (`crypto.randomBytes(32)`), stored in the database with a 10-minute TTL, tied to the user session, and single-use consumed on callback.

4. **IDOR & Multi-Tenant Isolation:**
   - Every API endpoint verifies account ownership (`userId` match).
   - Reconnecting or modifying account settings verifies the account belongs to the authenticated user.

5. **Capacity Management:**
   - Enforces the 20-slot account capacity limit per user.
