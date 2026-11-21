import { describe, expect, it } from 'vitest';
import { ExtensionClient } from '../client.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('extension API client', () => {
  it('sends the bearer token and never a cookie', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const client = new ExtensionClient({
      baseUrl: 'https://api.invalid',
      accessToken: 'access-1',
      fetch: async (url, init) => {
        calls.push({ url: String(url), init });
        return jsonResponse({ entitlements: [{ productVersionId: 'mark1-v1' }] });
      },
    });

    await client.entitlements();

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe('https://api.invalid/v1/entitlement?productVersionId=mark1-v1');
    const headers = calls[0]!.init?.headers as Record<string, string>;
    expect(headers.authorization).toBe('Bearer access-1');
    expect(String(calls[0]!.init?.credentials)).toBe('omit');
  });

  it('reports the entitlement gate as closed when the server returns none', async () => {
    const client = new ExtensionClient({
      baseUrl: 'https://api.invalid',
      accessToken: 'access-1',
      fetch: async () => jsonResponse({ entitlements: [] }),
    });

    await expect(client.hasEntitlement()).resolves.toBe(false);
  });

  it('reports the entitlement gate as open only for a non-revoked entitlement', async () => {
    const client = new ExtensionClient({
      baseUrl: 'https://api.invalid',
      accessToken: 'access-1',
      fetch: async () => jsonResponse({
        entitlements: [
          { productVersionId: 'old', status: 'revoked' },
          { productVersionId: 'mark1-v1', status: 'active' },
        ],
      }),
    });

    await expect(client.hasEntitlement()).resolves.toBe(true);
  });

  it('surfaces server error codes without leaking response bodies', async () => {
    const client = new ExtensionClient({
      baseUrl: 'https://api.invalid',
      accessToken: 'access-1',
      fetch: async () => jsonResponse({ code: 'UNAUTHENTICATED', message: 'no' }, 401),
    });

    await expect(client.entitlements()).rejects.toThrow('UNAUTHENTICATED');
  });

  it('refuses to call the API without an access token', async () => {
    const client = new ExtensionClient({
      baseUrl: 'https://api.invalid',
      accessToken: null,
      fetch: async () => jsonResponse({ entitlements: [] }),
    });

    await expect(client.hasEntitlement()).rejects.toThrow('NOT_SIGNED_IN');
  });
});
