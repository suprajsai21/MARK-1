import { describe, expect, it } from 'vitest';
import Fastify from 'fastify';
import { OAuthService } from '../service.js';
import { registerOAuthRoutes } from '../routes.js';
import { configuredClient, configuredRedirect, MemoryOAuthStore, s256 } from './fixtures.js';

const customer = { id: 'user-1', email: 'customer@example.test', emailVerified: true, role: 'customer' as const };
const verifier = 'verifier-value-that-is-long-enough-for-pkce';

function makeApp() {
  const store = new MemoryOAuthStore();
  const oauth = new OAuthService({ store, clientId: configuredClient, redirectUris: [configuredRedirect] });
  const app = Fastify({ logger: false });
  registerOAuthRoutes(app, {
    oauth,
    allowedOrigin: 'https://portal.example.test',
    authenticate: async (request) => request.headers.authorization === 'Session test' ? customer : null,
  });
  return { app, store };
}

describe('OAuth HTTP routes', () => {
  it('GET renders authorization information without issuing a code', async () => {
    const { app, store } = makeApp();
    const response = await app.inject({
      method: 'GET',
      url: `/v1/oauth/authorize?client_id=${configuredClient}&redirect_uri=${encodeURIComponent(configuredRedirect)}&response_type=code&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=opaque`,
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ clientId: configuredClient, consentRequired: true });
    expect(response.json()).not.toHaveProperty('redirectUrl');
    expect(store.codes.size).toBe(0);
    await app.close();
  });

  it('rejects absent origin on consent POST', async () => {
    const { app, store } = makeApp();
    const response = await app.inject({
      method: 'POST', url: '/v1/oauth/authorize',
      headers: { authorization: 'Session test' },
      payload: { clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge: s256(verifier), consented: true },
    });
    expect(response.statusCode).toBe(403);
    expect(store.codes.size).toBe(0);
    await app.close();
  });

  it('rejects consent when the allowed origin is missing from route configuration', async () => {
    const store = new MemoryOAuthStore();
    const oauth = new OAuthService({ store, clientId: configuredClient, redirectUris: [configuredRedirect] });
    const app = Fastify({ logger: false });
    registerOAuthRoutes(app, {
      oauth,
      authenticate: async () => customer,
      // Simulate incomplete JavaScript/runtime configuration despite the TS contract.
    } as unknown as Parameters<typeof registerOAuthRoutes>[1]);

    const response = await app.inject({
      method: 'POST', url: '/v1/oauth/authorize',
      payload: { clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge: s256(verifier), consented: true },
    });
    expect(response.statusCode).toBe(403);
    expect(store.codes.size).toBe(0);
    await app.close();
  });

  it('POST creates a code only with authenticated customer consent and the allowed origin', async () => {
    const { app, store } = makeApp();
    const query = `client_id=${configuredClient}&redirect_uri=${encodeURIComponent(configuredRedirect)}&code_challenge=${s256(verifier)}&code_challenge_method=S256&state=opaque`;
    const body = { clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge: s256(verifier), consented: true, state: 'opaque' };

    const unauthenticated = await app.inject({ method: 'POST', url: `/v1/oauth/authorize?${query}`, headers: { origin: 'https://portal.example.test' }, payload: body });
    expect(unauthenticated.statusCode).toBe(401);
    expect(store.codes.size).toBe(0);

    const forbiddenOrigin = await app.inject({ method: 'POST', url: `/v1/oauth/authorize?${query}`, headers: { origin: 'https://attacker.example' }, payload: body });
    expect(forbiddenOrigin.statusCode).toBe(403);
    expect(store.codes.size).toBe(0);

    const accepted = await app.inject({
      method: 'POST', url: `/v1/oauth/authorize?${query}`,
      headers: { origin: 'https://portal.example.test', authorization: 'Session test' }, payload: body,
    });
    expect(accepted.statusCode).toBe(200);
    expect(accepted.json().redirectUrl).toContain('code=');
    expect(store.codes.size).toBe(1);
    await app.close();
  });

  it('rejects authorization requests without an explicit true consent grant', async () => {
    const { app, store } = makeApp();
    const base = {
      clientId: configuredClient,
      redirectUri: configuredRedirect,
      codeChallenge: s256(verifier),
    };

    for (const payload of [base, { ...base, consented: false }]) {
      const response = await app.inject({
        method: 'POST',
        url: '/v1/oauth/authorize',
        headers: { origin: 'https://portal.example.test', authorization: 'Session test' },
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(store.codes.size).toBe(0);
    }
    await app.close();
  });

  it('refuses to render consent for an unapproved client or redirect', async () => {
    const { app } = makeApp();
    const badClient = await app.inject({
      method: 'GET',
      url: `/v1/oauth/authorize?client_id=attacker&redirect_uri=${encodeURIComponent(configuredRedirect)}&response_type=code&code_challenge=${s256(verifier)}&code_challenge_method=S256`,
    });
    expect(badClient.statusCode).toBe(400);
    expect(badClient.json().code).toBe('INVALID_CLIENT');

    const badRedirect = await app.inject({
      method: 'GET',
      url: `/v1/oauth/authorize?client_id=${configuredClient}&redirect_uri=${encodeURIComponent(`${configuredRedirect}/attacker`)}&response_type=code&code_challenge=${s256(verifier)}&code_challenge_method=S256`,
    });
    expect(badRedirect.statusCode).toBe(400);
    expect(badRedirect.json().code).toBe('INVALID_REDIRECT_URI');
    await app.close();
  });

  it('exchanges a code for tokens and revokes the family over HTTP', async () => {
    const { app, store } = makeApp();
    const authorization = await app.inject({
      method: 'POST',
      url: '/v1/oauth/authorize',
      headers: { origin: 'https://portal.example.test', authorization: 'Session test' },
      payload: { clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge: s256(verifier), consented: true },
    });
    const code = new URL(authorization.json().redirectUrl).searchParams.get('code')!;

    const exchanged = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      headers: { origin: 'chrome-extension://extension-id' },
      payload: { grantType: 'authorization_code', code, clientId: configuredClient, redirectUri: configuredRedirect, codeVerifier: verifier },
    });
    expect(exchanged.statusCode).toBe(200);
    expect(exchanged.json()).toMatchObject({ expiresIn: 900 });
    expect(store.families.size).toBe(1);

    const revoked = await app.inject({
      method: 'POST',
      url: '/v1/oauth/revoke',
      headers: { origin: 'https://portal.example.test' },
      payload: { token: exchanged.json().refreshToken, clientId: configuredClient },
    });
    expect(revoked.statusCode).toBe(200);
    expect([...store.families.values()][0]!.revokedAt).not.toBeNull();

    const afterRevoke = await app.inject({
      method: 'POST',
      url: '/v1/oauth/token',
      headers: { origin: 'https://portal.example.test' },
      payload: { grantType: 'refresh_token', refreshToken: exchanged.json().refreshToken, clientId: configuredClient },
    });
    expect(afterRevoke.statusCode).toBe(400);
    expect(afterRevoke.json().code).toBe('INVALID_GRANT');
    await app.close();
  });

  it('does not authorize an unverified customer or an admin', async () => {
    const app = Fastify({ logger: false });
    const oauth = new OAuthService({ store: new MemoryOAuthStore(), clientId: configuredClient, redirectUris: [configuredRedirect] });
    registerOAuthRoutes(app, {
      oauth,
      allowedOrigin: 'https://portal.example.test',
      authenticate: async (request) => request.headers.authorization === 'Session admin'
        ? { ...customer, role: 'admin' }
        : request.headers.authorization === 'Session unverified' ? { ...customer, emailVerified: false } : null,
    });
    const query = `client_id=${configuredClient}&redirect_uri=${encodeURIComponent(configuredRedirect)}&response_type=code&code_challenge=${s256(verifier)}&code_challenge_method=S256`;

    for (const auth of ['Session admin', 'Session unverified']) {
      const response = await app.inject({ method: 'POST', url: `/v1/oauth/authorize?${query}`, headers: { origin: 'https://portal.example.test', authorization: auth }, payload: { clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge: s256(verifier), consented: true } });
      expect(response.statusCode).toBe(403);
    }
    await app.close();
  });
});
