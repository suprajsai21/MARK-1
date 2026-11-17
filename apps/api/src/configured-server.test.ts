import { describe, expect, it } from 'vitest';
import { buildConfiguredServer } from './server.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';

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
});
