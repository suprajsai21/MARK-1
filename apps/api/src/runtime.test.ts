import { describe, expect, it } from 'vitest';
import { createRuntime } from './runtime.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';

const baseEnv = {
  DATABASE_URL: 'postgresql://customer:password@localhost:5432/mark1_dev',
  WEB_ORIGIN: 'https://portal.example.test',
  EMAIL_FROM: 'no-reply@example.test',
  SMTP_URL: 'smtp://localhost:1025',
  NODE_ENV: 'test',
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

  it('wires the configured origin and email adapter into auth', () => {
    const runtime = createRuntime(baseEnv);
    expect(runtime.allowedOrigin).toBe(baseEnv.WEB_ORIGIN);
    expect(runtime.auth).toBeDefined();
  });

  it('uses injected adapters for local development and tests', () => {
    const runtime = createRuntime(baseEnv, {
      repository: new MemoryAuthRepository(),
      emailSender: new MemoryEmailSender(),
    });
    expect(runtime.allowedOrigin).toBe(baseEnv.WEB_ORIGIN);
  });
});
