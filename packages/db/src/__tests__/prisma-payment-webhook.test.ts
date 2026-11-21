import { describe, expect, it } from 'vitest';
import { PrismaPaymentDatabase } from '../prisma-payment-database.js';

function makeWebhookDatabase() {
  const state = {
    orders: [{ id: 'order-1', userId: 'user-1', productVersionId: 'mark1-v1', amountPaise: 19900n, currency: 'INR',
      priceVersionId: 'price-1', priceVersion: 1, razorpayOrderId: 'rzp_order_1', status: 'created' }] as Array<Record<string, unknown>>,
    purchases: [] as Array<Record<string, unknown>>,
    entitlements: [] as Array<Record<string, unknown>>,
    refunds: [] as Array<Record<string, unknown>>,
    events: [] as Array<Record<string, unknown>>,
    forcePurchaseConflict: false,
  };
  let sequence = 0;
  const matches = (row: Record<string, unknown>, where: Record<string, unknown>) =>
    Object.entries(where).every(([key, expected]) => {
      if (typeof expected === 'object' && expected !== null && 'in' in expected) {
        return (expected as { in: unknown[] }).in.includes(row[key]);
      }
      return row[key] === expected;
    });
  const makeTransaction = () => ({
    priceVersion: { async updateMany() { return { count: 0 }; }, async findFirst() { return null; }, async create({ data }: { data: Record<string, unknown> }) { return { id: 'price', ...data }; } },
    paymentOrder: {
      async create({ data }: { data: Record<string, unknown> }) { const row = { id: 'order-2', status: 'created', ...data }; state.orders.push(row); return row; },
      async findFirst({ where }: { where: Record<string, unknown> }) { return state.orders.find((row) => matches(row, where)) ?? null; },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        const row = state.orders.find((item) => matches(item, where));
        if (!row) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
    },
    purchase: {
      async findFirst({ where }: { where: Record<string, unknown> }) { return state.purchases.find((row) => Object.entries(where).every(([key, value]) => row[key] === value)) ?? null; },
      async create({ data }: { data: Record<string, unknown> }) {
        if (state.forcePurchaseConflict || state.purchases.some((row) => row.providerPaymentId === data.providerPaymentId || row.orderId === data.orderId)) {
          throw Object.assign(new Error('unique purchase'), { code: 'P2002', meta: { target: ['providerPaymentId'] } });
        }
        const row = { id: `purchase-${++sequence}`, ...data };
        state.purchases.push(row);
        return row;
      },
    },
    entitlement: {
      async upsert({ where, create, update }: { where: { purchaseId: string }; create: Record<string, unknown>; update: Record<string, unknown> }) {
        const row = state.entitlements.find((item) => item.purchaseId === where.purchaseId);
        if (row) Object.assign(row, update); else state.entitlements.push({ id: `entitlement-${sequence}`, ...create });
      },
      async updateMany({ where, data }: { where: Record<string, unknown>; data: Record<string, unknown> }) {
        let count = 0;
        for (const row of state.entitlements) if (Object.entries(where).every(([key, value]) => row[key] === value)) { Object.assign(row, data); count++; }
        return { count };
      },
      async findMany({ where }: { where: Record<string, unknown> }) { return state.entitlements.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)); },
    },
    refund: { async create({ data }: { data: Record<string, unknown> }) { if (state.refunds.some((row) => row.providerRefundId === data.providerRefundId)) throw Object.assign(new Error('unique refund'), { code: 'P2002', meta: { target: ['providerRefundId'] } }); const row = { id: `refund-${++sequence}`, ...data }; state.refunds.push(row); return row; } },
    paymentEvent: { async create({ data }: { data: Record<string, unknown> }) { if (state.events.some((row) => row.providerEventId === data.providerEventId)) throw Object.assign(new Error('unique event'), { code: 'P2002', meta: { target: ['providerEventId'] } }); const row = { id: `event-${++sequence}`, ...data }; state.events.push(row); return row; } },
  });
  const client = {
    ...makeTransaction(), accountLink: { async findFirst() { return { id: 'link-1' }; } },
    async $transaction<T>(callback: (tx: ReturnType<typeof makeTransaction>) => Promise<T>) {
      const snapshot = structuredClone(state);
      try {
        return await callback(makeTransaction());
      } catch (error) {
        state.orders = snapshot.orders;
        state.purchases = snapshot.purchases;
        state.entitlements = snapshot.entitlements;
        state.refunds = snapshot.refunds;
        state.events = snapshot.events;
        throw error;
      }
    },
  };
  return { adapter: new PrismaPaymentDatabase(client as never), state };
}

describe('PrismaPaymentDatabase webhook transactions', () => {
  it('grants one purchase and active entitlement for a matching captured order', async () => {
    const { adapter, state } = makeWebhookDatabase();
    const accepted = await adapter.processEvent('evt-1', 'payment.captured', 'digest', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    });
    expect(accepted).toBe(true);
    expect(state.purchases).toHaveLength(1);
    expect(state.entitlements).toMatchObject([{ userId: 'user-1', productVersionId: 'mark1-v1', status: 'active' }]);
    expect(state.orders[0]?.status).toBe('paid');
  });

  it('rolls back event processing when captured amount does not match its order', async () => {
    const { adapter, state } = makeWebhookDatabase();
    await expect(adapter.processEvent('evt-bad', 'payment.captured', 'digest', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 100n, currency: 'INR' });
    })).rejects.toThrow('PAYMENT_MISMATCH');
    expect(state.events).toHaveLength(0);
    expect(state.purchases).toHaveLength(0);
  });

  it('revokes an entitlement and keeps the order terminal after a refund', async () => {
    const { adapter, state } = makeWebhookDatabase();
    await adapter.processEvent('evt-capture', 'payment.captured', 'digest-a', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    });
    await adapter.processEvent('evt-refund', 'refund.processed', 'digest-b', async (tx) => {
      await tx.applyRefund({ providerPaymentId: 'pay-1', providerRefundId: 'rfnd-1', amountPaise: 19900n, reason: 'refunded' });
    });
    expect(state.entitlements[0]).toMatchObject({ status: 'revoked', revokeReason: 'refunded' });
    expect(state.orders[0]?.status).toBe('refunded');
  });

  it('rejects a provider payment ID already attached to another order', async () => {
    const { adapter, state } = makeWebhookDatabase();
    state.orders.push({ id: 'order-2', userId: 'user-2', productVersionId: 'mark1-v1', amountPaise: 19900n, currency: 'INR',
      priceVersionId: 'price-1', priceVersion: 1, razorpayOrderId: 'rzp_order_2', status: 'created' });
    await adapter.processEvent('evt-first', 'payment.captured', 'digest-a', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    });
    await expect(adapter.processEvent('evt-conflicting', 'payment.captured', 'digest-b', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_2', amountPaise: 19900n, currency: 'INR' });
    })).rejects.toThrow('PAYMENT_MISMATCH');
    expect(state.orders[1]?.status).toBe('created');
    expect(state.purchases).toHaveLength(1);
    expect(state.events.map((event) => event.providerEventId)).toEqual(['evt-first']);
  });

  it('revokes access after any verified partial refund', async () => {
    const { adapter, state } = makeWebhookDatabase();
    await adapter.processEvent('evt-capture', 'payment.captured', 'digest-a', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    });
    await adapter.processEvent('evt-partial-refund', 'refund.processed', 'digest-b', async (tx) => {
      await tx.applyRefund({ providerPaymentId: 'pay-1', providerRefundId: 'rfnd-partial', amountPaise: 5000n, reason: 'refunded' });
    });
    expect(state.refunds).toMatchObject([{ amountPaise: 5000n, reason: 'refunded' }]);
    expect(state.entitlements[0]).toMatchObject({ status: 'revoked', revokeReason: 'refunded' });
    expect(state.orders[0]?.status).toBe('refunded');
  });

  it('does not report a purchase uniqueness conflict as a replay', async () => {
    const { adapter, state } = makeWebhookDatabase();
    state.forcePurchaseConflict = true;
    await expect(adapter.processEvent('evt-capture', 'payment.captured', 'digest', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    })).rejects.toThrow('unique purchase');
    expect(state.events).toHaveLength(0);
    expect(state.orders[0]?.status).toBe('created');
  });

  it('does not restore access when a new capture event arrives after a refund', async () => {
    const { adapter, state } = makeWebhookDatabase();
    const capture = async (tx: Parameters<Parameters<typeof adapter.processEvent>[3]>[0]) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    };
    await adapter.processEvent('evt-capture', 'payment.captured', 'digest-a', capture);
    await adapter.processEvent('evt-refund', 'refund.processed', 'digest-b', async (tx) => {
      await tx.applyRefund({ providerPaymentId: 'pay-1', providerRefundId: 'rfnd-1', amountPaise: 19900n, reason: 'refunded' });
    });
    await adapter.processEvent('evt-late-capture', 'payment.captured', 'digest-c', capture);
    expect(state.orders[0]?.status).toBe('refunded');
    expect(state.entitlements[0]).toMatchObject({ status: 'revoked', revokeReason: 'refunded' });
    expect(state.purchases).toHaveLength(1);
  });

  it('treats the same provider refund ID in another webhook event as a safe replay', async () => {
    const { adapter, state } = makeWebhookDatabase();
    await adapter.processEvent('evt-capture', 'payment.captured', 'digest-a', async (tx) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    });
    const applyRefund = async (tx: Parameters<Parameters<typeof adapter.processEvent>[3]>[0]) => {
      await tx.applyRefund({ providerPaymentId: 'pay-1', providerRefundId: 'rfnd-duplicate', amountPaise: 19900n, reason: 'refunded' });
    };
    expect(await adapter.processEvent('evt-refund-1', 'refund.processed', 'digest-b', applyRefund)).toBe(true);
    expect(await adapter.processEvent('evt-refund-2', 'refund.processed', 'digest-c', applyRefund)).toBe(false);
    expect(state.events.map((event) => event.providerEventId)).toEqual(['evt-capture', 'evt-refund-1']);
    expect(state.refunds).toHaveLength(1);
  });

  it('does not apply an event a second time', async () => {
    const { adapter, state } = makeWebhookDatabase();
    const apply = async (tx: Parameters<Parameters<typeof adapter.processEvent>[3]>[0]) => {
      await tx.applyCapturedPayment({ providerPaymentId: 'pay-1', razorpayOrderId: 'rzp_order_1', amountPaise: 19900n, currency: 'INR' });
    };
    expect(await adapter.processEvent('evt-once', 'payment.captured', 'digest', apply)).toBe(true);
    expect(await adapter.processEvent('evt-once', 'payment.captured', 'digest', apply)).toBe(false);
    expect(state.purchases).toHaveLength(1);
    expect(state.events).toHaveLength(1);
  });
});
