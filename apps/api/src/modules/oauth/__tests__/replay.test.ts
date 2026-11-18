import { describe, expect, it } from 'vitest';
import { configuredClient, configuredRedirect, makeOAuthService, s256 } from './fixtures.js';

describe('OAuth authorization-code replay and expiry', () => {
  it('allows an authorization code to be exchanged only once', async () => {
    const { service } = makeOAuthService();
    const verifier = 'verifier-value-that-is-long-enough-for-pkce';
    const authorization = await service.createAuthorizationCode({
      userId: 'user-1', clientId: configuredClient, redirectUri: configuredRedirect,
      codeChallenge: s256(verifier), consented: true,
    });
    const code = new URL(authorization.redirectUrl).searchParams.get('code')!;
    const input = { code, clientId: configuredClient, redirectUri: configuredRedirect, codeVerifier: verifier };

    await service.exchange(input);
    await expect(service.exchange(input)).rejects.toMatchObject({ code: 'INVALID_GRANT' });
  });

  it('rejects an expired authorization code', async () => {
    const harness = makeOAuthService();
    const verifier = 'verifier-value-that-is-long-enough-for-pkce';
    const authorization = await harness.service.createAuthorizationCode({
      userId: 'user-1', clientId: configuredClient, redirectUri: configuredRedirect,
      codeChallenge: s256(verifier), consented: true,
    });
    const code = new URL(authorization.redirectUrl).searchParams.get('code')!;
    harness.setNow(new Date('2026-11-17T12:05:00.000Z'));

    await expect(harness.service.exchange({
      code, clientId: configuredClient, redirectUri: configuredRedirect, codeVerifier: verifier,
    })).rejects.toMatchObject({ code: 'INVALID_GRANT' });
  });
});
