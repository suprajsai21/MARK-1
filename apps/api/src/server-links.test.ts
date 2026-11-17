import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { AuthService } from './modules/auth/service.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';
import { MemoryLinkDatabase } from './modules/links/__tests__/fixtures.js';

const origin = 'https://portal.example.test';

function createApp() {
  const auth = new AuthService({
    repository: new MemoryAuthRepository(),
    emailSender: new MemoryEmailSender(),
    webOrigin: origin,
  });
  return buildServer({
    auth,
    allowedOrigin: origin,
    linkDatabase: new MemoryLinkDatabase(),
    verifier: null,
    subjectHmacSecret: 'test-secret',
  });
}

describe('server link wiring', () => {
  it('mounts link and admin routes with session-only authentication', async () => {
    const app = createApp();
    const links = await app.inject({ method: 'GET', url: '/v1/links' });
    expect(links.statusCode).toBe(401);
    const policy = await app.inject({ method: 'GET', url: '/v1/admin/link-policy' });
    expect(policy.statusCode).toBe(401);
    const headerClaim = await app.inject({
      method: 'GET',
      url: '/v1/admin/link-policy',
      headers: { authorization: 'Bearer admin' },
    });
    expect(headerClaim.statusCode).toBe(401);
    const challenge = await app.inject({
      method: 'POST',
      url: '/v1/links/challenges',
      headers: { origin },
      payload: { integrationId: 'integration-a' },
    });
    expect(challenge.statusCode).toBe(401);
    await app.close();
  });
});
