import Fastify from 'fastify';
import { describe, expect, it } from 'vitest';
import { registerAdminRoutes } from '../../admin/routes.js';
import { authorizeAdmin } from '../../admin/authorization.js';
import type { AuthService } from '../../auth/service.js';
import { registerLinkRoutes } from '../routes.js';
import { LinkService } from '../service.js';
import { MemoryLinkDatabase } from './fixtures.js';

const now = new Date('2026-11-17T12:00:00.000Z');
const verifiedCustomer = { id: 'customer-1', email: 'customer@example.test', emailVerified: true, role: 'customer' as const };
const admin = { id: 'admin-1', email: 'admin@example.test', emailVerified: true, role: 'admin' as const };
const origin = 'https://portal.example.test';

function linkApp(options: { verifier?: { verify: () => Promise<{ externalSubject: string } | null> } | null } = {}) {
  const database = new MemoryLinkDatabase();
  const app = Fastify();
  const auth = {
    authenticateSession: async (token: string) => (token === 'session-a' ? verifiedCustomer : null),
  } as unknown as AuthService;
  const links = new LinkService({
    database,
    verifier: options.verifier ?? null,
    subjectHmacSecret: 'test-secret',
    now: () => now,
  });
  registerLinkRoutes(app, { links, auth, allowedOrigin: origin });
  return { app, database };
}

describe('link lifecycle and authorization', () => {
  it('requires an authenticated, verified session for link routes', async () => {
    const { app } = linkApp({ verifier: { verify: async () => ({ externalSubject: 'external-1' }) } });
    const anonymous = await app.inject({ method: 'GET', url: '/v1/links' });
    expect(anonymous.statusCode).toBe(401);
    const noOrigin = await app.inject({ method: 'POST', url: '/v1/links/challenges', headers: { cookie: 'mark1_session=session-a' }, payload: { integrationId: 'integration-a' } });
    expect(noOrigin.statusCode).toBe(403);
    const ok = await app.inject({ method: 'POST', url: '/v1/links/challenges', headers: { origin, cookie: 'mark1_session=session-a' }, payload: { integrationId: 'integration-a' } });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().challenge).toBeTruthy();
    await app.close();
  });

  it('fails closed over HTTP when no verifier is configured', async () => {
    const { app, database } = linkApp({ verifier: null });
    const challenge = await app.inject({ method: 'POST', url: '/v1/links/challenges', headers: { origin, cookie: 'mark1_session=session-a' }, payload: { integrationId: 'integration-a' } });
    expect(challenge.statusCode).toBe(503);
    expect(challenge.json().code).toBe('VERIFIER_UNAVAILABLE');

    // A syntactically valid challenge id still cannot complete: no verifier means no proof is acceptable.
    const completion = await app.inject({ method: 'POST', url: '/v1/links/complete', headers: { origin, cookie: 'mark1_session=session-a' }, payload: { challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: 'proof' } });
    expect(completion.statusCode).toBe(503);
    expect(completion.json().code).toBe('VERIFIER_UNAVAILABLE');

    const unlink = await app.inject({ method: 'DELETE', url: '/v1/links/123e4567-e89b-42d3-a456-426614174000', headers: { origin, cookie: 'mark1_session=session-a' }, payload: { challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: 'proof' } });
    expect(unlink.statusCode).toBe(503);
    expect(unlink.json().code).toBe('VERIFIER_UNAVAILABLE');
    expect(database.links.size).toBe(0);
    await app.close();
  });

  it('allows only an authenticated admin to change link policy', async () => {
    const database = new MemoryLinkDatabase();
    const app = Fastify();
    registerAdminRoutes(app, { database, authenticate: async (request) => request.headers.authorization === 'Bearer admin' ? admin : verifiedCustomer });

    const denied = await app.inject({ method: 'PUT', url: '/v1/admin/link-policy', payload: { relinkCooldownHours: 48, requiresReverification: true, adminTransferApprovalRequired: true } });
    expect(denied.statusCode).toBe(403);
    const allowed = await app.inject({ method: 'PUT', url: '/v1/admin/link-policy', headers: { authorization: 'Bearer admin', origin: 'https://portal.example.test' }, payload: { relinkCooldownHours: 48, requiresReverification: true, adminTransferApprovalRequired: true } });
    expect(allowed.statusCode).toBe(200);
    expect(database.policy.relinkCooldownHours).toBe(48);
    await app.close();
  });

  it('rejects an unauthenticated caller on admin routes', async () => {
    const app = Fastify();
    registerAdminRoutes(app, { database: new MemoryLinkDatabase(), authenticate: async () => null });
    const response = await app.inject({ method: 'GET', url: '/v1/admin/link-policy' });
    expect(response.statusCode).toBe(401);
    await app.close();
  });

  it('does not allow a customer to authorize administration', async () => {
    expect(() => authorizeAdmin(verifiedCustomer)).toThrow('ADMIN_REQUIRED');
    expect(() => authorizeAdmin(admin)).not.toThrow();
  });

  it('requires fresh verifier proof before unlinking and audits link/unlink actions', async () => {
    const database = new MemoryLinkDatabase();
    const verifier = { verify: async (input: { proof: string }) => input.proof === 'fresh-proof' ? { externalSubject: 'external-1' } : null };
    const service = new LinkService({ database, verifier, subjectHmacSecret: 'test-secret', now: () => now });
    const initial = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    const completed = await service.complete({ actor: verifiedCustomer, challengeId: initial.challengeId, proof: 'fresh-proof' });

    const staleProof = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    await expect(
      service.unlink({ actor: verifiedCustomer, linkId: completed.linkId, challengeId: staleProof.challengeId, proof: 'wrong-proof' }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(database.links.size).toBe(1);

    const fresh = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    await service.unlink({ actor: verifiedCustomer, linkId: completed.linkId, challengeId: fresh.challengeId, proof: 'fresh-proof' });

    expect(database.links.size).toBe(0);
    expect(database.audits.map((row) => row.action)).toEqual(['link', 'unlink']);
  });

  it('refuses to unlink when a different external identity answers the proof', async () => {
    const database = new MemoryLinkDatabase();
    let identity = 'external-1';
    const verifier = { verify: async () => ({ externalSubject: identity }) };
    const service = new LinkService({ database, verifier, subjectHmacSecret: 'test-secret', now: () => now });
    const initial = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    const completed = await service.complete({ actor: verifiedCustomer, challengeId: initial.challengeId, proof: 'proof' });

    identity = 'external-2';
    const challenge = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    await expect(
      service.unlink({ actor: verifiedCustomer, linkId: completed.linkId, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(database.links.size).toBe(1);
  });

  it('fails closed when unlinking without an approved verifier', async () => {
    const database = new MemoryLinkDatabase();
    const service = new LinkService({ database, verifier: { verify: async () => ({ externalSubject: 'external-1' }) }, subjectHmacSecret: 'test-secret', now: () => now });
    const initial = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    const completed = await service.complete({ actor: verifiedCustomer, challengeId: initial.challengeId, proof: 'proof' });

    const unconfigured = new LinkService({ database, verifier: null, subjectHmacSecret: 'test-secret', now: () => now });
    const challenge = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    await expect(
      unconfigured.unlink({ actor: verifiedCustomer, linkId: completed.linkId, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'VERIFIER_UNAVAILABLE' });
    expect(database.links.size).toBe(1);
  });

  it('does not let one customer unlink another customer’s link', async () => {
    const database = new MemoryLinkDatabase();
    const service = new LinkService({ database, verifier: { verify: async () => ({ externalSubject: 'external-1' }) }, subjectHmacSecret: 'test-secret', now: () => now });
    const initial = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    const completed = await service.complete({ actor: verifiedCustomer, challengeId: initial.challengeId, proof: 'proof' });

    const other = { ...verifiedCustomer, id: 'customer-2', email: 'other@example.test' };
    const challenge = await service.createChallenge({ actor: other, integrationId: 'integration-a' });
    await expect(
      service.unlink({ actor: other, linkId: completed.linkId, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'LINK_NOT_FOUND' });
    expect(database.links.size).toBe(1);
  });

  it('enforces the configured cooldown before relinking and releases after the cooldown', async () => {
    const database = new MemoryLinkDatabase();
    database.policy.relinkCooldownHours = 1;
    let clock = now;
    const service = new LinkService({ database, verifier: { verify: async () => ({ externalSubject: 'external-1' }) }, subjectHmacSecret: 'test-secret', now: () => clock });
    const initial = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    const linked = await service.complete({ actor: verifiedCustomer, challengeId: initial.challengeId, proof: 'proof' });
    const unlinkChallenge = await service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' });
    await service.unlink({ actor: verifiedCustomer, linkId: linked.linkId, challengeId: unlinkChallenge.challengeId, proof: 'proof' });

    await expect(service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' })).rejects.toMatchObject({ code: 'RELINK_COOLDOWN' });
    clock = new Date(now.getTime() + 60 * 60_000);
    await expect(service.createChallenge({ actor: verifiedCustomer, integrationId: 'integration-a' })).resolves.toMatchObject({ challengeId: expect.any(String) });
  });
});
