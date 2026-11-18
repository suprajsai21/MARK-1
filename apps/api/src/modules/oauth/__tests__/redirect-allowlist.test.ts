import { describe, expect, it } from 'vitest';
import { configuredClient, configuredRedirect, makeOAuthService, s256 } from './fixtures.js';

describe('OAuth redirect allowlist', () => {
  it('rejects clients and redirect URIs not exactly configured', async () => {
    const { service } = makeOAuthService();
    const base = { userId: 'user-1', clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge: s256('verifier-value-long-enough-to-be-valid'), consented: true as const };

    await expect(service.createAuthorizationCode({ ...base, clientId: 'attacker-client' }))
      .rejects.toMatchObject({ code: 'INVALID_CLIENT' });
    await expect(service.createAuthorizationCode({ ...base, redirectUri: `${configuredRedirect}/attacker` }))
      .rejects.toMatchObject({ code: 'INVALID_REDIRECT_URI' });
  });
});
