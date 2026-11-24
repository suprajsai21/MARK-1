import { buildConfiguredServer } from '../apps/api/dist/server.js';
import { createPrismaClient } from '../packages/db/dist/client.js';

async function verify() {
  console.log('--- 1. Testing Neon DB Connection & Runtime Initialization ---');
  const app = buildConfiguredServer(process.env);

  await app.ready();
  console.log('✓ Fastify app built and ready.');

  console.log('\n--- 2. Health Probes Verification ---');
  const liveRes = await app.inject({ method: 'GET', url: '/health/live' });
  console.log(`/health/live: ${liveRes.statusCode} ${liveRes.body}`);
  if (liveRes.statusCode !== 200) throw new Error('Live probe failed');

  const readyRes = await app.inject({ method: 'GET', url: '/health/ready' });
  console.log(`/health/ready: ${readyRes.statusCode} ${readyRes.body}`);
  if (readyRes.statusCode !== 200) throw new Error('Ready probe failed');

  console.log('\n--- 3. Customer Authentication Verification ---');
  const loginRes = await app.inject({
    method: 'POST',
    url: '/v1/auth/login',
    headers: { origin: 'http://localhost:5173' },
    payload: {
      email: 'customer@mark1.internal',
      password: 'Password123!',
    },
  });
  console.log(`/v1/auth/login status: ${loginRes.statusCode}`);
  const cookieHeader = loginRes.headers['set-cookie'];
  console.log(`Cookie received: ${Boolean(cookieHeader)}`);
  if (loginRes.statusCode !== 200 || !cookieHeader) {
    throw new Error('Customer login failed: ' + loginRes.body);
  }

  // Extract session cookie
  const cookieValue = Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader;

  console.log('\n--- 4. Active Entitlement Check Verification ---');
  const entitlementRes = await app.inject({
    method: 'GET',
    url: '/v1/entitlement?productVersionId=mark1-v1',
    headers: {
      origin: 'http://localhost:5173',
      cookie: cookieValue,
    },
  });
  console.log(`/v1/entitlement status: ${entitlementRes.statusCode}`);
  console.log('Entitlement response:', entitlementRes.body);
  const entitlementData = JSON.parse(entitlementRes.body);
  if (!entitlementData.entitlements || entitlementData.entitlements.length === 0 || entitlementData.entitlements[0].status !== 'active') {
    throw new Error('Customer has no active entitlement!');
  }
  console.log('✓ Verified: Customer has active entitlement for mark1-v1!');

  console.log('\n--- 5. Extension OAuth PKCE Flow Verification ---');
  // Client creates PKCE verifier & challenge
  const verifier = 'a'.repeat(48);
  const crypto = await import('node:crypto');
  const challenge = crypto.createHash('sha256').update(verifier).digest('base64url');
  const state = 's'.repeat(32);
  const redirectUri = 'https://mark1-extension.chromiumapp.org/oauth/callback';

  // 5a. GET /v1/oauth/authorize consent query
  const consentInfoRes = await app.inject({
    method: 'GET',
    url: `/v1/oauth/authorize?client_id=mark1-extension&redirect_uri=${encodeURIComponent(redirectUri)}&response_type=code&code_challenge=${challenge}&code_challenge_method=S256&state=${state}`,
  });
  console.log(`/v1/oauth/authorize GET: ${consentInfoRes.statusCode} ${consentInfoRes.body}`);

  // 5b. POST /v1/oauth/authorize with authenticated cookie
  const authorizeRes = await app.inject({
    method: 'POST',
    url: '/v1/oauth/authorize',
    headers: {
      origin: 'http://localhost:5173',
      cookie: cookieValue,
    },
    payload: {
      clientId: 'mark1-extension',
      redirectUri,
      codeChallenge: challenge,
      state,
      consented: true,
    },
  });
  console.log(`/v1/oauth/authorize POST: ${authorizeRes.statusCode}`);
  const authData = JSON.parse(authorizeRes.body);
  console.log('Authorization redirectUrl:', authData.redirectUrl);
  if (!authData.redirectUrl) throw new Error('Authorization failed: ' + authorizeRes.body);

  // 5c. Parse code from redirectUrl
  const url = new URL(authData.redirectUrl);
  const code = url.searchParams.get('code');
  console.log('Extracted OAuth code:', code);

  // 5d. Exchange code for tokens at /v1/oauth/token
  const tokenRes = await app.inject({
    method: 'POST',
    url: '/v1/oauth/token',
    payload: {
      grantType: 'authorization_code',
      clientId: 'mark1-extension',
      code,
      redirectUri,
      codeVerifier: verifier,
    },
  });
  console.log(`/v1/oauth/token status: ${tokenRes.statusCode}`);
  const tokenData = JSON.parse(tokenRes.body);
  console.log(`Access token received: ${Boolean(tokenData.accessToken)}`);
  if (!tokenData.accessToken) throw new Error('Token exchange failed: ' + tokenRes.body);

  // 5e. Extension queries entitlement using Bearer accessToken
  const extEntitlementRes = await app.inject({
    method: 'GET',
    url: '/v1/entitlement?productVersionId=mark1-v1',
    headers: {
      authorization: `Bearer ${tokenData.accessToken}`,
    },
  });
  console.log(`Extension Bearer /v1/entitlement: ${extEntitlementRes.statusCode} ${extEntitlementRes.body}`);
  const extData = JSON.parse(extEntitlementRes.body);
  if (!extData.entitlements || extData.entitlements[0]?.status !== 'active') {
    throw new Error('Extension entitlement check failed!');
  }

  console.log('\n======================================================');
  console.log('ALL INTEGRATION CHECKS PASSED PERFECTLY!');
  console.log('======================================================');
  await app.close();
  process.exit(0);
}

verify().catch((err) => {
  console.error('VERIFICATION ERROR:', err);
  process.exit(1);
});
