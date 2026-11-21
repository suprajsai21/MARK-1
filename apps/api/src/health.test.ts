import { describe, expect, it } from 'vitest';
import { buildServer } from './server.js';
import { AuthService } from './modules/auth/service.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from '@mark-1/db';

const auth = new AuthService({
  repository: new MemoryAuthRepository(),
  emailSender: new MemoryEmailSender(),
  webOrigin: 'https://app.example',
});

describe('API readiness probe', () => {
  it('reports ready when all required dependency probes pass', async () => {
    const app = buildServer({
      auth,
      allowedOrigin: 'https://app.example',
      readinessCheck: async () => {},
      checkRequiredDependencies: async () => {},
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ready' });
    await app.close();
  });

  it('fails readiness when a required integration dependency is missing', async () => {
    const app = buildServer({
      auth,
      allowedOrigin: 'https://app.example',
      readinessCheck: async () => {},
      checkRequiredDependencies: async () => { throw new Error('oauth unavailable'); },
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
    await app.close();
  });

  it('reports 503 when the dependency probe fails', async () => {
    const app = buildServer({
      auth,
      allowedOrigin: 'https://app.example',
      readinessCheck: async () => { throw new Error('database unavailable'); },
    });
    const response = await app.inject({ method: 'GET', url: '/health/ready' });
    expect(response.statusCode).toBe(503);
    expect(response.json()).toEqual({ status: 'not_ready' });
  });

  it('stays live independently of readiness', async () => {
    const app = buildServer({
      auth,
      allowedOrigin: 'https://app.example',
      readinessCheck: async () => { throw new Error('database unavailable'); },
    });
    const response = await app.inject({ method: 'GET', url: '/health/live' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ status: 'ok' });
    await app.close();
  });
});
