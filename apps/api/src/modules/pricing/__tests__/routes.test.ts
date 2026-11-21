import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerPricingRoutes } from '../routes.js';
import { PricingService } from '../service.js';

const apps: ReturnType<typeof Fastify>[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map((app) => app.close()));
});

function makeApp(role: 'admin' | 'customer' | null) {
  const app = Fastify({ logger: false });
  const current: { id: string; productVersionId: string; amountPaise: bigint; currency: 'INR'; version: number } | null = null;
  const database = {
    async setCurrentPrice(input: { productVersionId: string; amountPaise: bigint }) {
      return { id: 'price-1', ...input, currency: 'INR' as const, version: 1 };
    },
    async getCurrentPrice() { return current; },
  };
  registerPricingRoutes(app, {
    pricing: new PricingService({ database, productVersionId: 'mark1-v1' }),
    allowedOrigin: 'https://mark1.example',
    authenticate: async () => role ? {
      id: `${role}-1`, email: `${role}@example.test`, role, emailVerified: true,
    } : null,
  });
  apps.push(app);
  return app;
}

describe('pricing routes', () => {
  it('allows only an authenticated admin to change the current price', async () => {
    const app = makeApp('customer');
    const response = await app.inject({
      method: 'PUT', url: '/v1/admin/pricing/current',
      headers: { origin: 'https://mark1.example' },
      payload: { productVersionId: 'mark1-v1', amountPaise: 12345 },
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'ADMIN_REQUIRED' });
  });

  it('rejects unauthenticated price changes', async () => {
    const app = makeApp(null);
    const response = await app.inject({
      method: 'PUT', url: '/v1/admin/pricing/current',
      headers: { origin: 'https://mark1.example' },
      payload: { productVersionId: 'mark1-v1', amountPaise: 12345 },
    });
    expect(response.statusCode).toBe(401);
  });

  it('allows an admin to set a valid price with the required origin', async () => {
    const app = makeApp('admin');
    const response = await app.inject({
      method: 'PUT', url: '/v1/admin/pricing/current',
      headers: { origin: 'https://mark1.example' },
      payload: { productVersionId: 'mark1-v1', amountPaise: 12345 },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ productVersionId: 'mark1-v1', amountPaise: 12345, currency: 'INR', version: 1 });
  });
});
