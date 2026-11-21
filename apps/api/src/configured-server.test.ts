import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { buildConfiguredServer } from './server.js';
import { MemoryEmailSender } from './modules/auth/email-sender.js';
import { MemoryAuthRepository } from './modules/auth/__tests__/fixtures.js';
import { makeOAuthService, s256 } from './modules/oauth/__tests__/fixtures.js';
import { tokenHash } from './modules/oauth/service.js';

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

  it('mounts pricing and checkout routes when payment dependencies are configured', async () => {
    const paymentDatabase = {
      async setCurrentPrice() { return { id: 'price-1', productVersionId: 'mark1-v1', amountPaise: 9900n, currency: 'INR' as const, version: 1 }; },
      async getCurrentPrice() { return { id: 'price-1', productVersionId: 'mark1-v1', amountPaise: 9900n, currency: 'INR' as const, version: 1 }; },
      async createOrder(input: Record<string, unknown>) { return { id: 'order-1', status: 'created', ...input } as never; },
      async findOrderForUser() { return null; },
      async hasLinkedAccount() { return true; },
    };
    const app = buildConfiguredServer({ ...environment, RAZORPAY_KEY_ID: 'rzp_test_public', RAZORPAY_KEY_SECRET: 'test-secret' }, {
      repository: new MemoryAuthRepository(), emailSender: new MemoryEmailSender(),
      paymentDatabase,
      razorpayClient: { async createOrder() { return { id: 'rzp-order-1' }; } },
    });
    const price = await app.inject({ method: 'GET', url: '/v1/pricing/current' });
    const checkout = await app.inject({ method: 'POST', url: '/v1/checkout/orders', headers: { origin: environment.WEB_ORIGIN }, payload: {} });
    expect(price.statusCode).toBe(200);
    expect(price.json().price).toMatchObject({ amountPaise: 9900, currency: 'INR' });
    expect(checkout.statusCode).toBe(401);
    expect(checkout.json().code).toBe('UNAUTHENTICATED');
    await app.close();
  });

  it('mounts signature-verified webhook and authenticated entitlement routes', async () => {
    const webhookSecret = 'configured-test-webhook-secret';
    const events: string[] = [];
    const entitlements: Array<Record<string, string>> = [];
    const paymentDatabase = {
      async setCurrentPrice() { return { id: 'price-1', productVersionId: 'mark1-v1', amountPaise: 9900n, currency: 'INR' as const, version: 1 }; },
      async getCurrentPrice() { return null; },
      async createOrder(input: Record<string, unknown>) { return { id: 'order-1', status: 'created', ...input } as never; },
      async findOrderForUser() { return null; },
      async hasLinkedAccount() { return true; },
      async getEntitlementsForUser(userId: string, productVersionId: string) {
        entitlements.push({ userId, productVersionId });
        return [{ productVersionId, status: 'active' as const }];
      },
      async processEvent(eventId: string) { events.push(eventId); return true; },
    };
    const app = buildConfiguredServer({ ...environment, RAZORPAY_KEY_ID: 'rzp_test_public', RAZORPAY_KEY_SECRET: 'test-secret', RAZORPAY_WEBHOOK_SECRET: webhookSecret }, {
      repository: new MemoryAuthRepository(), emailSender: new MemoryEmailSender(), paymentDatabase,
      razorpayClient: { async createOrder() { return { id: 'rzp-order-1' }; } },
    });
    const body = Buffer.from('{ "id": "evt-configured", "event": "payment.captured" }');
    const signature = createHmac('sha256', webhookSecret).update(body).digest('hex');
    const webhookResponse = await app.inject({ method: 'POST', url: '/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': signature }, payload: body });
    const rejectedResponse = await app.inject({ method: 'POST', url: '/v1/webhooks/razorpay', headers: { 'content-type': 'application/json', 'x-razorpay-signature': '0'.repeat(64) }, payload: body });
    const entitlementResponse = await app.inject({ method: 'GET', url: '/v1/entitlement?productVersionId=mark1-v1' });
    expect(webhookResponse.statusCode).toBe(200);
    expect(webhookResponse.json()).toEqual({ accepted: true, duplicate: false });
    expect(rejectedResponse.statusCode).toBe(400);
    expect(events).toEqual(['evt-configured']);
    expect(entitlementResponse.statusCode).toBe(401);
    expect(entitlements).toHaveLength(0);
    await app.close();
  });

  it('uses the MARK-1 session cookie to authenticate explicit OAuth consent', async () => {
    const repository = new MemoryAuthRepository();
    const account = await repository.createUser({ email: 'customer@example.test', passwordHash: 'test-hash' });
    repository.users.set(account.email, { ...account, emailVerified: true });
    await repository.createSession(account.id, tokenHash('session-token'), new Date(Date.now() + 60_000));
    const { service, store } = makeOAuthService();
    const app = buildConfiguredServer(environment, {
      repository,
      emailSender: new MemoryEmailSender(),
      oauthService: service,
    });

    const response = await app.inject({
      method: 'POST',
      url: '/v1/oauth/authorize',
      headers: { origin: environment.WEB_ORIGIN, cookie: 'mark1_session=session-token' },
      payload: {
        clientId: 'extension-client-test',
        redirectUri: 'https://extension.invalid/oauth/callback',
        codeChallenge: s256('verifier-value-that-is-long-enough-for-pkce'),
        consented: true,
      },
    });

    expect(response.statusCode).toBe(200);
    expect(new URL(response.json().redirectUrl).searchParams.get('code')).toBeTruthy();
    expect(store.codes.size).toBe(1);
    await app.close();
  });
});
