import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { AuthService } from '../service.js';
import { registerAuthRoutes } from '../routes.js';
import { MemoryEmailSender } from '../email-sender.js';
import { MemoryAuthRepository } from './fixtures.js';

const origin = 'https://portal.example.test';
const input = { email: 'customer@example.com', password: 'correct horse battery staple' };

async function makeApp() {
  const app = Fastify();
  const repository = new MemoryAuthRepository();
  const emailSender = new MemoryEmailSender();
  const auth = new AuthService({ repository, emailSender, webOrigin: origin });
  await registerAuthRoutes(app, { auth, allowedOrigin: origin });
  return { app, repository, emailSender };
}

describe('auth routes', () => {
  it('requires the configured origin for state-changing requests', async () => {
    const { app } = await makeApp();
    const response = await app.inject({ method: 'POST', url: '/v1/auth/register', payload: input });
    expect(response.statusCode).toBe(403);
    expect(response.json().code).toBe('ORIGIN_FORBIDDEN');
    await app.close();
  });

  it('returns no session token in JSON and emits secure cookie attributes', async () => {
    const { app, emailSender } = await makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin }, payload: input });
    const token = new URL(emailSender.verificationEmails[0]!.verificationUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/v1/auth/verify-email', headers: { origin }, payload: { token } });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: input });
    expect(login.statusCode).toBe(200);
    expect(login.headers['set-cookie']).toContain('HttpOnly');
    expect(login.headers['set-cookie']).toContain('Secure');
    expect(login.headers['set-cookie']).toContain('SameSite=Lax');
    expect(login.body).not.toContain('mark1_session=');
    expect(login.json().user.email).toBe('customer@example.com');
    await app.close();
  });

  it('requires a verified customer session for GET /v1/me and revokes on logout', async () => {
    const { app, emailSender } = await makeApp();
    await app.inject({ method: 'POST', url: '/v1/auth/register', headers: { origin }, payload: input });
    const unverified = await app.inject({ method: 'GET', url: '/v1/me' });
    expect(unverified.statusCode).toBe(401);
    const token = new URL(emailSender.verificationEmails[0]!.verificationUrl).searchParams.get('token')!;
    await app.inject({ method: 'POST', url: '/v1/auth/verify-email', headers: { origin }, payload: { token } });
    const login = await app.inject({ method: 'POST', url: '/v1/auth/login', headers: { origin }, payload: input });
    const cookieHeader = login.headers['set-cookie'];
    const cookie = (Array.isArray(cookieHeader) ? cookieHeader[0] : cookieHeader)!.split(';')[0]!;
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode).toBe(200);
    await app.inject({ method: 'POST', url: '/v1/auth/logout', headers: { origin, cookie } });
    expect((await app.inject({ method: 'GET', url: '/v1/me', headers: { cookie } })).statusCode).toBe(401);
    await app.close();
  });
});
