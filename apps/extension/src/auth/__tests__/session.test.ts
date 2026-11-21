import { describe, expect, it } from 'vitest';
import { ExtensionAuth, createMemorySessionStore, type BrowserAuth } from '../session.js';
import { createPkcePair, buildAuthorizationUrl } from '../pkce.js';

function testAuth(callback?: (url: string) => string, fetcher: typeof fetch = async () => new Response('{}')) {
  const store = createMemorySessionStore();
  const browserAuth: BrowserAuth = {
    getRedirectURL: () => 'https://extension.invalid/oauth/callback',
    launchWebAuthFlow: async ({ url }) => callback ? callback(url) : '',
  };
  const auth = new ExtensionAuth({
    authorizeUrl: 'https://api.invalid/v1/oauth/authorize',
    tokenUrl: 'https://api.invalid/v1/oauth/token',
    clientId: 'client-1',
    scope: 'extension',
    apiBaseUrl: 'https://api.invalid',
    browserAuth,
    sessionStore: store,
    fetch: fetcher,
  });
  return { auth, store };
}

function callbackFor(url: string): string {
  const authUrl = new URL(url);
  const state = authUrl.searchParams.get('state')!;
  return `https://extension.invalid/oauth/callback?state=${state}&code=code-1`;
}

describe('extension OAuth session', () => {
  it('keeps the verifier in the code exchange and stores only the access token', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const { auth, store } = testAuth(callbackFor, async (url, init) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify({ accessToken: 'access-1', expiresIn: 900 }), { status: 200 });
    });

    const session = await auth.signIn();
    expect(session.accessToken).toBe('access-1');
    expect(await store.read()).toEqual(session);
    expect(calls).toHaveLength(1);
    const body = JSON.parse(String(calls[0]!.init?.body));
    expect(body.codeVerifier).toMatch(/^[A-Za-z0-9._~-]{43,128}$/);
    expect(body.grantType).toBe('authorization_code');
    expect(body.grant_type).toBeUndefined();
    expect(JSON.stringify(await store.read())).not.toContain('codeVerifier');
  });

  it('does not exchange the code when state is modified', async () => {
    let exchanges = 0;
    const { auth } = testAuth((url) => {
      const state = new URL(url).searchParams.get('state')!;
      return `https://extension.invalid/oauth/callback?state=${state}x&code=code-1`;
    }, async () => {
      exchanges += 1;
      return new Response('{}');
    });
    await expect(auth.signIn()).rejects.toThrow('OAUTH_STATE_MISMATCH');
    expect(exchanges).toBe(0);
  });

  it('clears expired sessions before constructing an API client', async () => {
    const store = createMemorySessionStore();
    await store.write({ accessToken: 'expired', expiresAt: Date.now() - 1 });
    const auth = new ExtensionAuth({
      authorizeUrl: 'https://api.invalid/authorize',
      tokenUrl: 'https://api.invalid/token',
      clientId: 'client-1',
      scope: 'extension',
      apiBaseUrl: 'https://api.invalid',
      browserAuth: {
        getRedirectURL: () => 'https://extension.invalid/oauth/callback',
        launchWebAuthFlow: async () => '',
      },
      sessionStore: store,
      fetch: async () => new Response('{}'),
    });
    const client = await auth.client();
    await expect(client.hasEntitlement()).rejects.toThrow('NOT_SIGNED_IN');
    expect(await store.read()).toBeNull();
  });

  it('builds an authorization-code PKCE request with state and S256', async () => {
    const pair = await createPkcePair();
    const url = new URL(buildAuthorizationUrl({
      authorizeUrl: 'https://api.invalid/v1/oauth/authorize',
      clientId: 'client-1',
      redirectUri: 'https://extension.invalid/oauth/callback',
      scope: 'extension',
      pair,
    }));
    expect(url.searchParams.get('code_challenge')).toBe(pair.challenge);
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('state')).toBe(pair.state);
    expect(url.searchParams.get('code_verifier')).toBeNull();
  });
});
