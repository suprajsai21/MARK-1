/**
 * Structural view of the Prisma models used for pricing and checkout. The port
 * shapes are declared here so the persistence package does not depend on the
 * API consumer; they are structurally identical to the API's `PriceDatabase`
 * and `CheckoutDatabase` contracts.
 */
export type PrismaPriceRecord = {
  id: string;
  productVersionId: string;
  amountPaise: bigint;
  currency: 'INR';
  version: number;
  isCurrent: boolean;
  createdById: string;
};

export type PrismaPaymentOrderRecord = {
  id: string;
  userId: string;
  productVersionId: string;
  amountPaise: bigint;
  currency: 'INR';
  priceVersionId: string;
  priceVersion: number;
  razorpayOrderId: string;
  status: 'created' | 'paid' | 'failed' | 'refunded' | 'charged_back';
};

type PriceVersionWhere = { productVersionId: string; isCurrent?: boolean };

export type PrismaPurchaseRecord = {
  id: string;
  orderId: string;
  userId: string;
  productVersionId: string;
  amountPaise: bigint;
  currency: 'INR';
  providerPaymentId: string;
};
export type PrismaEntitlementRecord = {
  id: string;
  purchaseId: string;
  userId: string;
  productVersionId: string;
  status: 'active' | 'revoked';
  grantedAt: Date;
  revokedAt: Date | null;
  revokeReason: string | null;
};

type PrismaOrderWhere = { id?: string; userId?: string; razorpayOrderId?: string; status?: string | { in: string[] } };

function isDuplicateWebhookRecord(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error) || error.code !== 'P2002') return false;
  const meta = 'meta' in error && typeof error.meta === 'object' && error.meta !== null ? error.meta : undefined;
  const target = meta && 'target' in meta ? meta.target : undefined;
  const fields = Array.isArray(target) ? target : typeof target === 'string' ? [target] : [];
  return fields.some((field) => field === 'providerEventId' || field === 'providerRefundId'
    || field === 'PaymentEvent_providerEventId_key' || field === 'Refund_providerRefundId_key');
}

export interface PaymentTransactionalDatabase {
  priceVersion: {
    updateMany(input: { where: PriceVersionWhere; data: { isCurrent: false } }): Promise<{ count: number }>;
    findFirst(input: { where: PriceVersionWhere; orderBy?: { version: 'desc' } }): Promise<PrismaPriceRecord | null>;
    create(input: { data: Omit<PrismaPriceRecord, 'id'> }): Promise<PrismaPriceRecord>;
  };
  paymentOrder: {
    create(input: { data: Omit<PrismaPaymentOrderRecord, 'id' | 'status'> }): Promise<PrismaPaymentOrderRecord>;
    findFirst(input: { where: PrismaOrderWhere }): Promise<PrismaPaymentOrderRecord | null>;
    updateMany(input: { where: PrismaOrderWhere; data: { status: PrismaPaymentOrderRecord['status'] } }): Promise<{ count: number }>;
  };
  purchase: {
    findFirst(input: { where: { orderId?: string; providerPaymentId?: string } }): Promise<PrismaPurchaseRecord | null>;
    create(input: { data: Omit<PrismaPurchaseRecord, 'id'> }): Promise<PrismaPurchaseRecord>;
  };
  entitlement: {
    upsert(input: { where: { purchaseId: string }; create: Omit<PrismaEntitlementRecord, 'id' | 'grantedAt' | 'revokedAt' | 'revokeReason'>; update: Record<string, never> }): Promise<PrismaEntitlementRecord>;
    updateMany(input: { where: { purchaseId: string; status: 'active' }; data: { status: 'revoked'; revokedAt: Date; revokeReason: string } }): Promise<{ count: number }>;
    findMany(input: { where: { userId: string; productVersionId: string } }): Promise<PrismaEntitlementRecord[]>;
  };
  refund: {
    create(input: { data: { purchaseId: string; providerRefundId: string; amountPaise: bigint; reason: string } }): Promise<{ id: string }>;
  };
  paymentEvent: {
    create(input: { data: { providerEventId: string; eventType: string; payloadDigest: string; processedAt: Date } }): Promise<{ id: string }>;
  };
}

export interface PaymentDatabaseClient extends PaymentTransactionalDatabase {
  paymentOrder: PaymentTransactionalDatabase['paymentOrder'] & {
    findFirst(input: { where: { id: string; userId: string } }): Promise<PrismaPaymentOrderRecord | null>;
  };
  accountLink: {
    findFirst(input: { where: { userId: string }; select: { id: true } }): Promise<{ id: string } | null>;
  };
  $transaction<T>(callback: (transaction: PaymentTransactionalDatabase) => Promise<T>): Promise<T>;
}

/**
 * Durable price history and checkout orders. Prices are append-only: a new row
 * becomes current in the same transaction that clears the previous one, so a
 * concurrent checkout always reads exactly one current amount. Checkout orders
 * copy the amount and price-version identity, so a later price change cannot
 * alter an existing order.
 */
export class PrismaPaymentDatabase {
  constructor(private readonly database: PaymentDatabaseClient) {}

  async setCurrentPrice(input: { productVersionId: string; amountPaise: bigint; actorId: string }) {
    return this.database.$transaction(async (transaction) => {
      const latest = await transaction.priceVersion.findFirst({
        where: { productVersionId: input.productVersionId },
        orderBy: { version: 'desc' },
      });
      await transaction.priceVersion.updateMany({
        where: { productVersionId: input.productVersionId, isCurrent: true },
        data: { isCurrent: false },
      });
      const record = await transaction.priceVersion.create({
        data: {
          productVersionId: input.productVersionId,
          amountPaise: input.amountPaise,
          currency: 'INR',
          version: (latest?.version ?? 0) + 1,
          isCurrent: true,
          createdById: input.actorId,
        },
      });
      return { ...record, currency: 'INR' as const };
    });
  }

  async getCurrentPrice(productVersionId: string) {
    const record = await this.database.priceVersion.findFirst({
      where: { productVersionId, isCurrent: true },
    });
    return record ? { ...record, currency: 'INR' as const } : null;
  }

  /** Checkout only needs to know that a link exists, never the external identity. */
  async hasLinkedAccount(userId: string): Promise<boolean> {
    return Boolean(await this.database.accountLink.findFirst({ where: { userId }, select: { id: true } }));
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
    return this.database.paymentOrder.create({ data: input });
  }

  async findOrderForUser(orderId: string, userId: string) {
    return this.database.paymentOrder.findFirst({ where: { id: orderId, userId } });
  }

  async getEntitlementsForUser(userId: string, productVersionId: string) {
    return this.database.entitlement.findMany({ where: { userId, productVersionId } });
  }

  async processEvent(
    eventId: string,
    eventType: string,
    payloadDigest: string,
    apply: (transaction: {
      applyCapturedPayment(event: { providerPaymentId: string; razorpayOrderId: string; amountPaise: bigint; currency: 'INR' }): Promise<void>;
      applyFailedPayment(event: { razorpayOrderId: string }): Promise<void>;
      applyRefund(event: { providerPaymentId: string; providerRefundId: string; amountPaise: bigint; reason: 'refunded' | 'charged_back' }): Promise<void>;
    }) => Promise<void>,
  ): Promise<boolean> {
    try {
      await this.database.$transaction(async (transaction) => {
        await transaction.paymentEvent.create({
          data: { providerEventId: eventId, eventType, payloadDigest, processedAt: new Date() },
        });
        await apply({
          applyCapturedPayment: async (event) => {
            const order = await transaction.paymentOrder.findFirst({ where: { razorpayOrderId: event.razorpayOrderId } });
            if (!order || order.amountPaise !== event.amountPaise || order.currency !== event.currency) {
              throw new Error('PAYMENT_MISMATCH');
            }
            // Captured events may arrive after payment.failed; the provider's
            // captured event is authoritative and the transition below handles it.
            // A genuinely refunded or disputed order must never be reactivated.
            // The event is still recorded so the provider stops retrying it.
            if (order.status === 'refunded' || order.status === 'charged_back') {
              return;
            }
            const existing = await transaction.purchase.findFirst({ where: { orderId: order.id } });
            if (existing) {
              if (existing.providerPaymentId !== event.providerPaymentId) throw new Error('PAYMENT_MISMATCH');
              return;
            }
            // A provider payment ID belongs to exactly one order. Checking before
            // insert turns a cross-order reuse into a mismatch instead of a
            // unique-constraint error that could be misread as an event replay.
            const paidElsewhere = await transaction.purchase.findFirst({ where: { providerPaymentId: event.providerPaymentId } });
            if (paidElsewhere) throw new Error('PAYMENT_MISMATCH');
            if (order.status === 'failed') {
              const changed = await transaction.paymentOrder.updateMany({ where: { id: order.id, status: 'failed' }, data: { status: 'paid' } });
              if (changed.count !== 1) throw new Error('PAYMENT_STATE_CONFLICT');
            } else if (order.status === 'created') {
              const changed = await transaction.paymentOrder.updateMany({ where: { id: order.id, status: 'created' }, data: { status: 'paid' } });
              if (changed.count !== 1) throw new Error('PAYMENT_STATE_CONFLICT');
            } else if (order.status !== 'paid') throw new Error('PAYMENT_STATE_CONFLICT');
            const purchase = await transaction.purchase.create({ data: {
              orderId: order.id, userId: order.userId, productVersionId: order.productVersionId,
              amountPaise: order.amountPaise, currency: 'INR', providerPaymentId: event.providerPaymentId,
            } });
            await transaction.entitlement.upsert({
              where: { purchaseId: purchase.id },
              create: { purchaseId: purchase.id, userId: order.userId, productVersionId: order.productVersionId, status: 'active' },
              update: {},
            });
          },
          applyFailedPayment: async (event) => {
            const changed = await transaction.paymentOrder.updateMany({
              where: { razorpayOrderId: event.razorpayOrderId, status: 'created' }, data: { status: 'failed' },
            });
            void changed;
          },
          applyRefund: async (event) => {
            const purchase = await transaction.purchase.findFirst({ where: { providerPaymentId: event.providerPaymentId } });
            if (!purchase) throw new Error('PURCHASE_NOT_FOUND');
            await transaction.refund.create({ data: {
              purchaseId: purchase.id, providerRefundId: event.providerRefundId,
              amountPaise: event.amountPaise, reason: event.reason,
            } });
            await transaction.entitlement.updateMany({
              where: { purchaseId: purchase.id, status: 'active' },
              data: { status: 'revoked', revokedAt: new Date(), revokeReason: event.reason },
            });
            await transaction.paymentOrder.updateMany({
              where: { id: purchase.orderId, status: { in: ['created', 'paid', 'failed'] } },
              data: { status: event.reason === 'refunded' ? 'refunded' : 'charged_back' },
            });
          },
        });
      });
      return true;
    } catch (error) {
      if (isDuplicateWebhookRecord(error)) return false;
      throw error;
    }
  }
}
