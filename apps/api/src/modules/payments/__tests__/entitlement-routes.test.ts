import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '@mark-1/contracts';
import { registerEntitlementRoutes } from '../entitlement-routes.js';

const apps: ReturnType<typeof Fastify>[] = [];
const user: AuthUser = { id: 'user-1', email: 'customer@example.test', emailVerified: true, role: 'customer' };

describe('entitlement routes', () => {
  afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

  it('returns only the authenticated customer’s access status', async () => {
    const app = Fastify({ logger: false });
    registerEntitlementRoutes(app, {
      authenticate: async () => user,
      getForUser: async (userId) => userId === user.id ? [{ productVersionId: 'mark1-v1', status: 'active' as const }] : [],
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/v1/entitlement?productVersionId=mark1-v1' });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ entitlements: [{ productVersionId: 'mark1-v1', status: 'active' }] });
  });

  it('requires authentication and never returns another customer’s entitlement', async () => {
    const app = Fastify({ logger: false });
    registerEntitlementRoutes(app, {
      authenticate: async () => null,
      getForUser: async () => { throw new Error('must not query'); },
    });
    apps.push(app);
    const response = await app.inject({ method: 'GET', url: '/v1/entitlement?productVersionId=mark1-v1' });
    expect(response.statusCode).toBe(401);
  });
});
