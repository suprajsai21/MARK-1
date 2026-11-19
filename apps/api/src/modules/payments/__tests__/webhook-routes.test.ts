import { createHmac } from 'node:crypto';
import Fastify from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { registerWebhookRoutes } from '../webhook-routes.js';

const secret = 'webhook-secret';
const apps: ReturnType<typeof Fastify>[] = [];

function makeApp() {
  const app = Fastify({ logger: false });
  const seen: Buffer[] = [];
  registerWebhookRoutes(app, {
    secret,
    process: async (input) => {
      seen.push(input.rawBody);
      return { accepted: true, duplicate: false };
    },
  });
  apps.push(app);
  return { app, seen };
}

afterEach(async () => Promise.all(apps.splice(0).map((app) => app.close())));

describe('Razorpay webhook route', () => {
  it('passes exact raw JSON bytes and signature to webhook processing', async () => {
    const { app, seen } = makeApp();
    const body = Buffer.from('{ "event" : "payment.captured", "id": "evt_1" }');
    const signature = createHmac('sha256', secret).update(body).digest('hex');
    const response = await app.inject({
      method: 'POST', url: '/v1/webhooks/razorpay',
      headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature },
      payload: body,
    });
    expect(response.statusCode).toBe(200);
    expect(seen).toEqual([body]);
  });

  it('rejects missing signatures without invoking processing', async () => {
    const { app, seen } = makeApp();
    const response = await app.inject({ method: 'POST', url: '/v1/webhooks/razorpay', payload: { id: 'evt_1' } });
    expect(response.statusCode).toBe(400);
    expect(seen).toHaveLength(0);
  });
});
