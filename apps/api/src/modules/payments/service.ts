import { randomUUID } from 'node:crypto';
import type { AuthUser } from '@mark-1/contracts';
import type { RazorpayClient } from './razorpay-client.js';

export type CheckoutOrder = {
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

export interface CheckoutDatabase {
  getCurrentPrice(productVersionId: string): Promise<{
    id: string;
    productVersionId: string;
    amountPaise: bigint;
    currency: 'INR';
    version: number;
  } | null>;
  createOrder(input: {
    userId: string;
    productVersionId: string;
    amountPaise: bigint;
    currency: 'INR';
    priceVersionId: string;
    priceVersion: number;
    razorpayOrderId: string;
  }): Promise<CheckoutOrder>;
  findOrderForUser(orderId: string, userId: string): Promise<CheckoutOrder | null>;
}

export class CheckoutError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'CheckoutError';
  }
}

export class CheckoutService {
  constructor(private readonly options: {
    database: CheckoutDatabase;
    provider: RazorpayClient;
    productVersionId: string;
    checkoutKeyId: string;
    hasLinkedAccount: (userId: string) => Promise<boolean>;
  }) {}

  async createOrder(input: { actor: AuthUser | null }): Promise<{
    orderId: string;
    amountPaise: bigint;
    currency: 'INR';
    productVersionId: string;
    razorpayOrderId: string;
    checkoutKeyId: string;
  }> {
    const actor = input.actor;
    if (!actor) throw new CheckoutError('UNAUTHENTICATED');
    if (!actor.emailVerified) throw new CheckoutError('EMAIL_NOT_VERIFIED');
    if (!(await this.options.hasLinkedAccount(actor.id))) throw new CheckoutError('LINKED_ACCOUNT_REQUIRED');

    const price = await this.options.database.getCurrentPrice(this.options.productVersionId);
    if (!price || price.amountPaise <= 0n || price.amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new CheckoutError('PRICE_NOT_CONFIGURED');
    }
    const amountPaise = price.amountPaise;
    const receipt = randomUUID();
    const razorpayOrder = await this.options.provider.createOrder({
      amountPaise,
      currency: 'INR',
      receipt,
    });
    const order = await this.options.database.createOrder({
      userId: actor.id,
      productVersionId: this.options.productVersionId,
      amountPaise,
      currency: 'INR',
      priceVersionId: price.id,
      priceVersion: price.version,
      razorpayOrderId: razorpayOrder.id,
    });
    return {
      orderId: order.id,
      amountPaise: order.amountPaise,
      currency: order.currency,
      productVersionId: order.productVersionId,
      razorpayOrderId: order.razorpayOrderId,
      checkoutKeyId: this.options.checkoutKeyId,
    };
  }

  async getOrder(input: { actor: AuthUser | null; orderId: string }): Promise<{
    orderId: string;
    status: CheckoutOrder['status'];
    amountPaise: bigint;
    currency: 'INR';
    productVersionId: string;
  } | null> {
    if (!input.actor) throw new CheckoutError('UNAUTHENTICATED');
    const order = await this.options.database.findOrderForUser(input.orderId, input.actor.id);
    return order ? {
      orderId: order.id,
      status: order.status,
      amountPaise: order.amountPaise,
      currency: order.currency,
      productVersionId: order.productVersionId,
    } : null;
  }
}
