import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { AuthService } from './modules/auth/service.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';

describe('API server', () => {
  it('mounts the configured customer auth routes', async () => {
    const auth = new AuthService({
      repository: new MemoryAuthRepository(),
      emailSender: new MemoryEmailSender(),
      webOrigin: 'https://portal.example.test',
    });
    const app = buildServer({ auth, allowedOrigin: 'https://portal.example.test' });
    const response = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(response.statusCode).toBe(401);
    expect(response.json().code).toBe('UNAUTHENTICATED');
    await app.close();
  });
});
