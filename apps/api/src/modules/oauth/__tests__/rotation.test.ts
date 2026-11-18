import { describe, expect, it } from 'vitest';
import { configuredClient, configuredRedirect, makeOAuthService, s256 } from './fixtures.js';

const verifier = 'verifier-value-that-is-long-enough-for-pkce';

async function issueTokens(harness: ReturnType<typeof makeOAuthService>) {
  const authorization = await harness.service.createAuthorizationCode({
    userId: 'user-1', clientId: configuredClient, redirectUri: configuredRedirect,
    codeChallenge: s256(verifier), consented: true,
  });
  const code = new URL(authorization.redirectUrl).searchParams.get('code')!;
  return harness.service.exchange({ code, clientId: configuredClient, redirectUri: configuredRedirect, codeVerifier: verifier });
}

describe('refresh-token rotation', () => {
  it('issues a fresh refresh token and stops the previous one from working', async () => {
    const harness = makeOAuthService();
    const first = await issueTokens(harness);
    harness.setNow(new Date(harness.store.families.values().next().value!.refresh.values().next().value!.expiresAt.getTime() - 1));

    const second = await harness.service.exchangeRefresh({ refreshToken: first.refreshToken, clientId: configuredClient });

    expect(second.refreshToken).not.toBe(first.refreshToken);
    await expect(
      harness.service.exchangeRefresh({ refreshToken: first.refreshToken, clientId: configuredClient }),
    ).rejects.toMatchObject({ code: 'INVALID_GRANT' });
  });

  it('revokes the whole token family when a consumed refresh token is replayed', async () => {
    const harness = makeOAuthService();
    const first = await issueTokens(harness);
    const second = await harness.service.exchangeRefresh({ refreshToken: first.refreshToken, clientId: configuredClient });

    await expect(
      harness.service.exchangeRefresh({ refreshToken: first.refreshToken, clientId: configuredClient }),
    ).rejects.toMatchObject({ code: 'INVALID_GRANT' });

    // The replay revoked every token in the family, including the newest pair.
    await expect(
      harness.service.exchangeRefresh({ refreshToken: second.refreshToken, clientId: configuredClient }),
    ).rejects.toMatchObject({ code: 'INVALID_GRANT' });
    await expect(harness.service.authenticateAccessToken(second.accessToken)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });

  it('expires an access token after fifteen minutes', async () => {
    const harness = makeOAuthService();
    const tokens = await issueTokens(harness);
    await expect(harness.service.authenticateAccessToken(tokens.accessToken)).resolves.toMatchObject({ userId: 'user-1' });

    harness.setNow(new Date(harness.store.families.values().next().value!.access.values().next().value!.getTime()));
    await expect(harness.service.authenticateAccessToken(tokens.accessToken)).rejects.toMatchObject({ code: 'INVALID_TOKEN' });
  });
});
