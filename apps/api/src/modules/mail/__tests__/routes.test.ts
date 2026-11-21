import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import type { AuthUser } from '@mark-1/contracts';
import { MemoryMailDatabase, validateEncryptionKey } from '@mark-1/db';
import { MockGoogleOAuthClient } from '../google-client.js';
import { MailService } from '../service.js';
import { registerMailRoutes } from '../routes.js';

import type { AuthService } from '../../auth/service.js';

const testKey = validateEncryptionKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');
const allowedOrigin = 'http://localhost:5173';

const userA: AuthUser = {
  id: '11111111-1111-1111-1111-111111111111',
  email: 'usera@example.test',
  emailVerified: true,
  role: 'customer',
};

const userB: AuthUser = {
  id: '22222222-2222-2222-2222-222222222222',
  email: 'userb@example.test',
  emailVerified: true,
  role: 'customer',
};

function buildTestApp() {
  const database = new MemoryMailDatabase();
  const googleClient = new MockGoogleOAuthClient();
  const mail = new MailService({
    database,
    googleClient,
    encryptionKey: testKey,
    clientId: 'google-client-test',
    clientSecret: 'google-secret-test',
    defaultRedirectUri: 'http://localhost:5173/mail/callback',
  });

  const app = Fastify({ logger: false });

  const authMock = {
    async authenticateSession(token: string) {
      if (token === 'token_a') return userA;
      if (token === 'token_b') return userB;
      return null;
    },
  };

  registerMailRoutes(app, {
    mail,
    auth: authMock as unknown as AuthService,
    allowedOrigin,
  });

  return { app, database, googleClient, mail };
}

describe('Mail HTTP Routes', () => {
  it('rejects unauthenticated requests on all mail endpoints', async () => {
    const { app } = buildTestApp();

    const endpoints = [
      { method: 'GET', url: '/v1/mail/overview' },
      { method: 'GET', url: '/v1/mail/accounts' },
      { method: 'POST', url: '/v1/mail/accounts/connect/start' },
      { method: 'POST', url: '/v1/mail/accounts/connect/callback' },
      { method: 'GET', url: '/v1/mail/accounts/550e8400-e29b-41d4-a716-446655440000' },
      { method: 'GET', url: '/v1/mail/accounts/550e8400-e29b-41d4-a716-446655440000/health' },
      { method: 'POST', url: '/v1/mail/accounts/550e8400-e29b-41d4-a716-446655440000/disconnect' },
      { method: 'PATCH', url: '/v1/mail/accounts/550e8400-e29b-41d4-a716-446655440000/settings' },
      { method: 'GET', url: '/v1/mail/settings' },
    ] as const;

    for (const ep of endpoints) {
      const res = await app.inject({
        method: ep.method,
        url: ep.url,
        headers: ep.method === 'POST' || ep.method === 'PATCH' ? { origin: allowedOrigin } : {},
      });
      expect(res.statusCode).toBe(401);
      expect(res.json().code).toBe('UNAUTHENTICATED');
    }

    await app.close();
  });

  it('enforces origin guard against forbidden or missing origin on state-changing endpoints', async () => {
    const { app } = buildTestApp();

    const resNoOrigin = await app.inject({
      method: 'POST',
      url: '/v1/mail/accounts/connect/start',
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(resNoOrigin.statusCode).toBe(403);
    expect(resNoOrigin.json().code).toBe('ORIGIN_FORBIDDEN');

    const resWrongOrigin = await app.inject({
      method: 'POST',
      url: '/v1/mail/accounts/connect/start',
      headers: { cookie: 'mark1_session=token_a', origin: 'https://malicious-site.com' },
    });
    expect(resWrongOrigin.statusCode).toBe(403);
    expect(resWrongOrigin.json().code).toBe('ORIGIN_FORBIDDEN');

    await app.close();
  });

  it('supports full account lifecycle via HTTP: connect -> list -> details -> health -> settings -> disconnect', async () => {
    const { app, googleClient } = buildTestApp();

    // 1. Initiate connect
    const startRes = await app.inject({
      method: 'POST',
      url: '/v1/mail/accounts/connect/start',
      headers: { cookie: 'mark1_session=token_a', origin: allowedOrigin },
    });
    expect(startRes.statusCode).toBe(201);
    const { authorizationUrl, state } = startRes.json();
    expect(authorizationUrl).toContain('client_id=google-client-test');
    expect(state).toBeDefined();

    // 2. Prepare mock google responses & complete callback
    googleClient.exchangeResponses.set('code_http_1', {
      accessToken: 'access_http_token',
      refreshToken: 'refresh_http_token',
      expiresIn: 3600,
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });
    googleClient.userInfos.set('access_http_token', {
      id: 'g-http-user',
      email: 'alex@example.test',
      name: 'Alex Developer',
      picture: 'https://example.test/alex.jpg',
    });

    const callbackRes = await app.inject({
      method: 'POST',
      url: '/v1/mail/accounts/connect/callback',
      headers: { cookie: 'mark1_session=token_a', origin: allowedOrigin },
      payload: { code: 'code_http_1', state },
    });
    expect(callbackRes.statusCode).toBe(200);
    const { account } = callbackRes.json();
    expect(account.email).toBe('alex@example.test');
    expect(account.status).toBe('connected');

    // 3. Overview endpoint
    const overviewRes = await app.inject({
      method: 'GET',
      url: '/v1/mail/overview',
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(overviewRes.statusCode).toBe(200);
    expect(overviewRes.json().totalConnected).toBe(1);
    expect(overviewRes.json().slotCapacity).toBe(20);
    expect(overviewRes.json().recentActivity.length).toBeGreaterThan(0);

    // 4. Accounts list endpoint
    const listRes = await app.inject({
      method: 'GET',
      url: '/v1/mail/accounts',
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(listRes.statusCode).toBe(200);
    expect(listRes.json().accounts.length).toBe(1);

    // 5. Account details endpoint
    const detailRes = await app.inject({
      method: 'GET',
      url: `/v1/mail/accounts/${account.id}`,
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(detailRes.statusCode).toBe(200);
    expect(detailRes.json().account.email).toBe('alex@example.test');
    expect(detailRes.json().account.settings.syncFrequencyMinutes).toBe(15);

    // 6. Health check endpoint
    const healthRes = await app.inject({
      method: 'GET',
      url: `/v1/mail/accounts/${account.id}/health`,
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(healthRes.statusCode).toBe(200);
    expect(healthRes.json().healthy).toBe(true);
    expect(healthRes.json().status).toBe('connected');

    // 7. Update settings endpoint
    const settingsRes = await app.inject({
      method: 'PATCH',
      url: `/v1/mail/accounts/${account.id}/settings`,
      headers: { cookie: 'mark1_session=token_a', origin: allowedOrigin },
      payload: { syncFrequencyMinutes: 30, notifyOnSyncError: false },
    });
    expect(settingsRes.statusCode).toBe(200);
    expect(settingsRes.json().settings.syncFrequencyMinutes).toBe(30);

    // 8. Mail general settings endpoint
    const mailSettingsRes = await app.inject({
      method: 'GET',
      url: '/v1/mail/settings',
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(mailSettingsRes.statusCode).toBe(200);
    expect(mailSettingsRes.json().settings.slotCapacity).toBe(20);

    // 9. Disconnect endpoint
    const discRes = await app.inject({
      method: 'POST',
      url: `/v1/mail/accounts/${account.id}/disconnect`,
      headers: { cookie: 'mark1_session=token_a', origin: allowedOrigin },
      payload: { confirmEmail: 'alex@example.test' },
    });
    expect(discRes.statusCode).toBe(200);
    expect(discRes.json().disconnected).toBe(true);

    // Verify account is now disconnected
    const checkDisc = await app.inject({
      method: 'GET',
      url: `/v1/mail/accounts/${account.id}`,
      headers: { cookie: 'mark1_session=token_a' },
    });
    expect(checkDisc.json().account.status).toBe('disconnected');

    await app.close();
  });

  it('enforces IDOR protection: User B cannot access or modify User A accounts', async () => {
    const { app, googleClient } = buildTestApp();

    // User A connects account
    const startRes = await app.inject({
      method: 'POST',
      url: '/v1/mail/accounts/connect/start',
      headers: { cookie: 'mark1_session=token_a', origin: allowedOrigin },
    });
    const { state } = startRes.json();

    googleClient.exchangeResponses.set('code_idor_http', {
      accessToken: 'access_idor_token',
      expiresIn: 3600,
    });
    googleClient.userInfos.set('access_idor_token', {
      id: 'g-idor',
      email: 'owner@example.test',
    });

    const callbackRes = await app.inject({
      method: 'POST',
      url: '/v1/mail/accounts/connect/callback',
      headers: { cookie: 'mark1_session=token_a', origin: allowedOrigin },
      payload: { code: 'code_idor_http', state },
    });
    const { account } = callbackRes.json();

    // User B tries to view account details
    const viewRes = await app.inject({
      method: 'GET',
      url: `/v1/mail/accounts/${account.id}`,
      headers: { cookie: 'mark1_session=token_b' },
    });
    expect(viewRes.statusCode).toBe(404);

    // User B tries to run health check on User A's account
    const healthRes = await app.inject({
      method: 'GET',
      url: `/v1/mail/accounts/${account.id}/health`,
      headers: { cookie: 'mark1_session=token_b' },
    });
    expect(healthRes.statusCode).toBe(404);

    // User B tries to update User A's settings
    const patchRes = await app.inject({
      method: 'PATCH',
      url: `/v1/mail/accounts/${account.id}/settings`,
      headers: { cookie: 'mark1_session=token_b', origin: allowedOrigin },
      payload: { syncFrequencyMinutes: 60 },
    });
    expect(patchRes.statusCode).toBe(404);

    // User B tries to disconnect User A's account
    const discRes = await app.inject({
      method: 'POST',
      url: `/v1/mail/accounts/${account.id}/disconnect`,
      headers: { cookie: 'mark1_session=token_b', origin: allowedOrigin },
    });
    expect(discRes.statusCode).toBe(404);

    await app.close();
  });
});
