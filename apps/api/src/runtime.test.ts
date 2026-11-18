import { describe, expect, it } from 'vitest';
import { createRuntime } from './runtime.js';
import { OAuthService } from './modules/oauth/service.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';
import { MemoryOAuthStore } from './modules/oauth/__tests__/fixtures.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://customer:password@localhost:5432/mark1_dev',
  WEB_ORIGIN: 'https://portal.example.test',
  EMAIL_FROM: 'no-reply@example.test',
  SMTP_URL: 'smtp://localhost:1025',
  NODE_ENV: 'test',
  OAUTH_CLIENT_ID: 'extension-client-test',
  OAUTH_REDIRECT_URIS: 'https://extension.invalid/oauth/callback',
};

describe('API runtime configuration', () => {
  it('fails closed when required configuration is missing', () => {
    expect(() => createRuntime({ WEB_ORIGIN: baseEnv.WEB_ORIGIN })).toThrow('DATABASE_URL_REQUIRED');
    expect(() => createRuntime({ DATABASE_URL: baseEnv.DATABASE_URL })).toThrow('WEB_ORIGIN_REQUIRED');
  });

  it('fails closed when email delivery is not configured', () => {
    expect(() =>
      createRuntime({ DATABASE_URL: baseEnv.DATABASE_URL, WEB_ORIGIN: baseEnv.WEB_ORIGIN }),
    ).toThrow('EMAIL_PROVIDER_NOT_CONFIGURED');
  });

  it('wires the configured origin, email adapter, and extension client into auth', () => {
    const runtime = createRuntime(baseEnv);
    expect(runtime.allowedOrigin).toBe(baseEnv.WEB_ORIGIN);
    expect(runtime.auth).toBeDefined();
    expect(runtime.oauth?.clientId).toBe(baseEnv.OAUTH_CLIENT_ID);
    expect(runtime.oauth?.redirectUris).toEqual([baseEnv.OAUTH_REDIRECT_URIS]);
  });

  it('uses injected adapters for local development and tests', () => {
    const runtime = createRuntime(baseEnv, {
      repository: new MemoryAuthRepository(),
      emailSender: new MemoryEmailSender(),
      oauthService: new OAuthService({
        store: new MemoryOAuthStore(),
        clientId: baseEnv.OAUTH_CLIENT_ID,
        redirectUris: [baseEnv.OAUTH_REDIRECT_URIS],
      }),
    });
    expect(runtime.allowedOrigin).toBe(baseEnv.WEB_ORIGIN);
    expect(runtime.oauth?.clientId).toBe(baseEnv.OAUTH_CLIENT_ID);
  });

  it('exposes no OAuth service without a configured extension client', () => {
    const withoutOAuth = { ...baseEnv, OAUTH_CLIENT_ID: undefined, OAUTH_REDIRECT_URIS: undefined };
    expect(createRuntime(withoutOAuth).oauth).toBeUndefined();
  });

  it('refuses a half-configured extension client rather than guessing a redirect', () => {
    expect(() => createRuntime({ ...baseEnv, OAUTH_REDIRECT_URIS: undefined }))
      .toThrow('OAUTH_REDIRECT_URIS_REQUIRED');
    expect(() => createRuntime({ ...baseEnv, OAUTH_CLIENT_ID: undefined }))
      .toThrow('OAUTH_CLIENT_ID_REQUIRED');
  });

  it('parses a comma-separated redirect allowlist and rejects non-exact https entries', () => {
    const runtime = createRuntime({
      ...baseEnv,
      OAUTH_REDIRECT_URIS: 'https://extension.invalid/oauth/callback, https://extension.invalid/oauth/second',
    });
    expect(runtime.oauth?.redirectUris).toEqual([
      'https://extension.invalid/oauth/callback',
      'https://extension.invalid/oauth/second',
    ]);

    for (const invalid of ['/oauth/callback', 'http://extension.invalid/oauth/callback', 'https://extension.invalid/oauth/callback#fragment', 'https://user:pass@extension.invalid/oauth/callback']) {
      expect(() => createRuntime({ ...baseEnv, OAUTH_REDIRECT_URIS: invalid }))
        .toThrow('OAUTH_REDIRECT_URI_INVALID');
    }
  });
});
