import { describe, expect, it } from 'vitest';
import { buildConfiguredServer } from './server.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';
import { makeOAuthService, s256 } from './modules/oauth/__tests__/fixtures.js';
import { tokenHash } from './modules/oauth/service.js';

const environment = {
  DATABASE_URL: 'postgresql://customer:password@localhost:5432/mark1_dev',
  WEB_ORIGIN: 'https://portal.example.test',
  EMAIL_FROM: 'no-reply@example.test',
  SMTP_URL: 'smtp://localhost:1025',
  NODE_ENV: 'test',
};

describe('configured API server', () => {
  it('wires configured auth services and exposes their routes', async () => {
    const app = buildConfiguredServer(environment, {
      repository: new MemoryAuthRepository(),
      emailSender: new MemoryEmailSender(),
    });
    const response = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('uses the MARK-1 session cookie to authenticate explicit OAuth consent', async () => {
    const repository = new MemoryAuthRepository();
    const account = await repository.createUser({ email: 'customer@example.test', passwordHash: 'test-hash' });
    repository.users.set(account.email, { ...account, emailVerified: true });
    await repository.createSession(account.id, tokenHash('session-token'), new Date(Date.now() + 60_000));
    const { service, store } = makeOAuthService();
    const app = buildConfiguredServer(environment, {
      repository,
      emailSender: new MemoryEmailSender(),
      oauthService: service,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/oauth/authorize',
      headers: { origin: environment.WEB_ORIGIN, cookie: 'mark1_session=session-token' },
      payload: {
        clientId: 'extension-client-test',
        redirectUri: 'https://extension.invalid/oauth/callback',
        codeChallenge: s256('verifier-value-that-is-long-enough-for-pkce'),
        consented: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(new URL(response.json().redirectUrl).searchParams.get('code')).toBeTruthy();
    expect(store.codes.size).toBe(1);
    await app.close();
  });
});
