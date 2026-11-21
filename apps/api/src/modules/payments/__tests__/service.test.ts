import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@mark-1/contracts';
import { CheckoutService } from '../service.js';

const verifiedCustomer: AuthUser = {
  id: 'user-1',
  email: 'customer@example.test',
  emailVerified: true,
  role: 'customer',
};

class MemoryCheckoutDatabase {
  orders: Array<{
    id: string;
    userId: string;
    productVersionId: string;
    amountPaise: bigint;
    currency: 'INR';
    priceVersionId: string;
    priceVersion: number;
    razorpayOrderId: string;
    status: 'created';
  }> = [];

  async getCurrentPrice(productVersionId: string): Promise<{
    id: string;
    productVersionId: string;
    amountPaise: bigint;
    currency: 'INR';
    version: number;
  } | null> {
    return {
      id: 'price-1',
      productVersionId,
      amountPaise: 19900n,
      currency: 'INR' as const,
      version: 3,
    };
  }

  async createOrder(input: {
    userId: string;
    productVersionId: string;
    amountPaise: bigint;
    currency: 'INR';
    priceVersionId: string;
    priceVersion: number;
    razorpayOrderId: string;
  }) {
    const order = { id: `order-${this.orders.length + 1}`, status: 'created' as const, ...input };
    this.orders.push(order);
    return order;
  }

  async findOrderForUser(orderId: string, userId: string) {
    return this.orders.find((order) => order.id === orderId && order.userId === userId) ?? null;
  }
}

class MemoryProvider {
  created: Array<{ amountPaise: bigint; currency: 'INR'; receipt: string }> = [];
  async createOrder(input: { amountPaise: bigint; currency: 'INR'; receipt: string }) {
    this.created.push(input);
    return { id: `rzp_order_${this.created.length}` };
  }
}

function makeService(overrides: {
  actor?: AuthUser | null;
  hasLinkedAccount?: boolean;
  database?: MemoryCheckoutDatabase;
  provider?: MemoryProvider;
} = {}) {
  const database = overrides.database ?? new MemoryCheckoutDatabase();
  const provider = overrides.provider ?? new MemoryProvider();
  const service = new CheckoutService({
    database,
    provider,
    productVersionId: 'mark1-v1',
    checkoutKeyId: 'rzp_test_public_key',
    hasLinkedAccount: async () => overrides.hasLinkedAccount ?? true,
  });
  return { service, database, provider, actor: overrides.actor === undefined ? verifiedCustomer : overrides.actor };
}

describe('CheckoutService', () => {
  it('requires a verified email before creating an order', async () => {
    const { service } = makeService({ actor: { ...verifiedCustomer, emailVerified: false } });
    await expect(service.createOrder({ actor: { ...verifiedCustomer, emailVerified: false } }))
      .rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
  });

  it('requires an authenticated actor', async () => {
    const { service } = makeService();
    await expect(service.createOrder({ actor: null })).rejects.toMatchObject({ code: 'UNAUTHENTICATED' });
  });

  it('requires a linked account before creating an order', async () => {
    const { service } = makeService({ hasLinkedAccount: false });
    await expect(service.createOrder({ actor: verifiedCustomer }))
      .rejects.toMatchObject({ code: 'LINKED_ACCOUNT_REQUIRED' });
  });

  it('creates the provider order server-side from the current price only', async () => {
    const { service, provider, database } = makeService();
    const result = await service.createOrder({ actor: verifiedCustomer });

    expect(provider.created).toEqual([
      { amountPaise: 19900n, currency: 'INR', receipt: expect.any(String) },
    ]);
    expect(result).toMatchObject({
      amountPaise: 19900n,
      currency: 'INR',
      razorpayOrderId: 'rzp_order_1',
      checkoutKeyId: 'rzp_test_public_key',
    });
    expect(database.orders).toHaveLength(1);
    expect(database.orders[0]).toMatchObject({
      productVersionId: 'mark1-v1',
      amountPaise: 19900n,
      priceVersionId: 'price-1',
      priceVersion: 3,
    });
  });

  it('never accepts an amount or product version from the caller', async () => {
    const { service, provider } = makeService();
    await service.createOrder({ actor: verifiedCustomer, amountPaise: 1, productVersionId: 'other-v9' } as never);
    expect(provider.created[0]?.amountPaise).toBe(19900n);
  });

  it('fails closed when no current price is configured', async () => {
    const database = new MemoryCheckoutDatabase();
    database.getCurrentPrice = async () => null;
    const { service, provider } = makeService({ database });
    await expect(service.createOrder({ actor: verifiedCustomer })).rejects.toMatchObject({ code: 'PRICE_NOT_CONFIGURED' });
    expect(provider.created).toHaveLength(0);
  });

  it('returns only the order belonging to the requesting customer', async () => {
    const { service, database } = makeService();
    const created = await service.createOrder({ actor: verifiedCustomer });
    expect(await service.getOrder({ actor: verifiedCustomer, orderId: created.orderId })).toMatchObject({
      orderId: created.orderId,
      status: 'created',
    });
    expect(await service.getOrder({ actor: { ...verifiedCustomer, id: 'user-2' }, orderId: created.orderId }))
      .toBeNull();
    expect(database.orders).toHaveLength(1);
  });
});
