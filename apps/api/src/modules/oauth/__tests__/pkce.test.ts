import { describe, expect, it } from 'vitest';
import { configuredClient, configuredRedirect, makeOAuthService, s256 } from './fixtures.js';

describe('OAuth PKCE', () => {
  it('rejects a verifier that does not match the authorization code challenge', async () => {
    const { service } = makeOAuthService();
    const verifier = 'verifier-value-that-is-long-enough-for-pkce';
    const authorization = await service.createAuthorizationCode({
      userId: 'user-1', clientId: configuredClient, redirectUri: configuredRedirect,
      codeChallenge: s256(verifier), consented: true,
    });
    const code = new URL(authorization.redirectUrl).searchParams.get('code')!;

    await expect(service.exchange({
      code, clientId: configuredClient, redirectUri: configuredRedirect,
      codeVerifier: 'different-verifier-value-that-is-long-enough',
    })).rejects.toMatchObject({ code: 'INVALID_GRANT' });
  });
});
