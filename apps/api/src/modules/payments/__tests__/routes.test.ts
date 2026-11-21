import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { AuthUser } from '@mark-1/contracts';
import { registerCheckoutRoutes } from '../routes.js';
import { CheckoutService } from '../service.js';

const apps: ReturnType<typeof Fastify>[] = [];
const customer: AuthUser = {
  id: 'customer-1', email: 'customer@example.test', emailVerified: true, role: 'customer',
};

function makeApp(actor: AuthUser | null) {
  const app = Fastify({ logger: false });
  const database = {
    orders: [] as Array<Record<string, unknown>>,
    async getCurrentPrice(productVersionId: string) {
      return { id: 'price-1', productVersionId, amountPaise: 9900n, currency: 'INR' as const, version: 2 };
    },
    async createOrder(input: Record<string, unknown>) {
      const order = { id: `order-${this.orders.length + 1}`, status: 'created', ...input };
      this.orders.push(order);
      return order as never;
    },
    async findOrderForUser(orderId: string, userId: string) {
      return this.orders.find((order) => order.id === orderId && order.userId === userId) as never ?? null;
    },
  };
  const provider = { async createOrder() { return { id: 'rzp_order_1' }; } };
  registerCheckoutRoutes(app, {
    checkout: new CheckoutService({
      database,
      provider,
      productVersionId: 'mark1-v1',
      checkoutKeyId: 'rzp_key_public',
      hasLinkedAccount: async () => true,
    }),
    authenticate: async () => actor,
    allowedOrigin: 'https://mark1.example',
  });
  apps.push(app);
  return app;
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('checkout routes', () => {
  it('creates a checkout order without accepting a browser-supplied price', async () => {
    const app = makeApp(customer);
    const response = await app.inject({
      method: 'POST', url: '/v1/checkout/orders',
      headers: { origin: 'https://mark1.example' },
      payload: {},
    });
    expect(response.statusCode).toBe(201);
    expect(response.json()).toMatchObject({
      orderId: 'order-1', amountPaise: '9900', currency: 'INR',
      razorpayOrderId: 'rzp_order_1', checkoutKeyId: 'rzp_key_public',
    });
  });

  it('requires authentication to start checkout', async () => {
    const response = await makeApp(null).inject({
      method: 'POST', url: '/v1/checkout/orders',
      headers: { origin: 'https://mark1.example' }, payload: {},
    });
    expect(response.statusCode).toBe(401);
  });

  it('requires the configured origin to start checkout', async () => {
    const response = await makeApp(customer).inject({
      method: 'POST', url: '/v1/checkout/orders',
      headers: { origin: 'https://other.example' }, payload: {},
    });
    expect(response.statusCode).toBe(403);
    expect(response.json()).toMatchObject({ code: 'ORIGIN_FORBIDDEN' });
  });

  it('returns checkout state only to the owning customer', async () => {
    const app = makeApp(customer);
    const created = await app.inject({
      method: 'POST', url: '/v1/checkout/orders',
      headers: { origin: 'https://mark1.example' }, payload: {},
    });
    const read = await app.inject({ method: 'GET', url: '/v1/checkout/orders/order-1' });
    expect(created.statusCode).toBe(201);
    expect(read.statusCode).toBe(200);
    expect(read.json()).toMatchObject({ orderId: 'order-1', status: 'created', amountPaise: '9900', productVersionId: 'mark1-v1' });
  });
});
