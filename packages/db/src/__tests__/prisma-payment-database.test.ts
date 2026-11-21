import { describe, expect, it } from 'vitest';
import { PrismaPaymentDatabase } from '../prisma-payment-database.js';

function makeDatabase() {
  const prices: Array<Record<string, unknown>> = [];
  const orders: Array<Record<string, unknown>> = [];
  const links = [{ id: 'link-1' }];
  let linkQuery: unknown;
  let id = 0;
  const transaction = {
    priceVersion: {
      async updateMany({ where }: { where: { productVersionId: string; isCurrent?: boolean } }) {
        let count = 0;
        for (const price of prices) {
          if (price.productVersionId === where.productVersionId && price.isCurrent === where.isCurrent) {
            price.isCurrent = false;
            count += 1;
          }
        }
        return { count };
      },
      async findFirst({ where, orderBy }: { where: { productVersionId: string }; orderBy?: { version: 'desc' } }) {
        void orderBy;
        return prices.filter((price) => price.productVersionId === where.productVersionId)
          .sort((a, b) => Number(b.version) - Number(a.version))[0] as never ?? null;
      },
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `price-${++id}`, ...data };
        prices.push(row);
        return row as never;
      },
    },
    paymentOrder: {
      async create({ data }: { data: Record<string, unknown> }) {
        const row = { id: `order-${orders.length + 1}`, status: 'created', ...data };
        orders.push(row);
        return row as never;
      },
    },
  };
  const client = {
    ...transaction,
    accountLink: { async findFirst(args: unknown) { linkQuery = args; return links[0] ?? null; } },
    paymentOrder: {
      ...transaction.paymentOrder,
      async findFirst({ where }: { where: { id: string; userId: string } }) {
        return orders.find((order) => order.id === where.id && order.userId === where.userId) as never ?? null;
      },
    },
    async $transaction<T>(callback: (tx: typeof transaction) => Promise<T>) { return callback(transaction); },
  };
  return { adapter: new PrismaPaymentDatabase(client as never), prices, orders, getLinkQuery: () => linkQuery };
}

describe('PrismaPaymentDatabase', () => {
  it('appends current price versions and leaves the previous version unchanged', async () => {
    const { adapter, prices } = makeDatabase();
    const first = await adapter.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise: 12345n, actorId: 'admin-1' });
    const second = await adapter.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise: 20000n, actorId: 'admin-1' });
    expect(first).toMatchObject({ amountPaise: 12345n, version: 1, isCurrent: true });
    expect(second).toMatchObject({ amountPaise: 20000n, version: 2, isCurrent: true });
    expect(prices[0]).toMatchObject({ amountPaise: 12345n, version: 1, isCurrent: false });
    expect(await adapter.getCurrentPrice('mark1-v1')).toMatchObject({ amountPaise: 20000n, version: 2, currency: 'INR' });
  });

  it('persists checkout order amount and immutable price-version snapshot', async () => {
    const { adapter, orders } = makeDatabase();
    const order = await adapter.createOrder({
      userId: 'user-1', productVersionId: 'mark1-v1', amountPaise: 20000n, currency: 'INR',
      priceVersionId: 'price-2', priceVersion: 2, razorpayOrderId: 'rzp_order_1',
    });
    expect(order).toMatchObject({
      amountPaise: 20000n, productVersionId: 'mark1-v1', priceVersionId: 'price-2', priceVersion: 2,
    });
    expect(orders).toHaveLength(1);
  });

  it('checks only whether a linked account exists without exposing external identity data', async () => {
    const { adapter, getLinkQuery } = makeDatabase();
    expect(await adapter.hasLinkedAccount('user-1')).toBe(true);
    expect(getLinkQuery()).toEqual({ where: { userId: 'user-1' }, select: { id: true } });
  });
});
