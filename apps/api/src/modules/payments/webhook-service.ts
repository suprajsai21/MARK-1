import type { RazorpayEventVerifier, VerifiedRazorpayEvent } from './signature.js';

export type CapturedPaymentEvent = {
  providerPaymentId: string;
  razorpayOrderId: string;
  amountPaise: bigint;
  currency: 'INR';
};
export type FailedPaymentEvent = { razorpayOrderId: string };
export type RefundPaymentEvent = { providerPaymentId: string; providerRefundId: string; amountPaise: bigint; reason: 'refunded' | 'charged_back' };

export interface WebhookDatabase {
  processEvent(eventId: string, eventType: string, payloadDigest: string, apply: (transaction: WebhookTransaction) => Promise<void>): Promise<boolean>;
}
export interface WebhookTransaction {
  applyCapturedPayment(event: CapturedPaymentEvent): Promise<void>;
  applyFailedPayment(event: FailedPaymentEvent): Promise<void>;
  applyRefund(event: RefundPaymentEvent): Promise<void>;
}

function record(value: unknown): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('INVALID_WEBHOOK_PAYLOAD');
  return value as Record<string, unknown>;
}
function nested(value: unknown, ...keys: string[]): unknown {
  let result = value;
  for (const key of keys) result = record(result)[key];
  return result;
}
function string(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new Error('INVALID_WEBHOOK_PAYLOAD');
  return value;
}
function bigint(value: unknown): bigint {
  if (!Number.isSafeInteger(value) || Number(value) <= 0) throw new Error('INVALID_WEBHOOK_PAYLOAD');
  return BigInt(value as number);
}

export class WebhookService {
  constructor(private readonly options: {
    verifier: Pick<RazorpayEventVerifier, 'verify'>;
    secret: string;
    database: WebhookDatabase;
  }) {}

  async process(input: { rawBody: Buffer; signature: string }): Promise<{ accepted: boolean; duplicate: boolean }> {
    const event = this.options.verifier.verify({ ...input, secret: this.options.secret });
    const id = string(event.id);
    const eventType = event.event;
    const payloadDigest = (await import('node:crypto')).createHash('sha256').update(input.rawBody).digest('hex');
    const accepted = await this.options.database.processEvent(id, eventType, payloadDigest, async (tx) => {
      await this.apply(event, tx);
    });
    return { accepted: true, duplicate: !accepted };
  }

  private async apply(event: VerifiedRazorpayEvent, tx: WebhookTransaction): Promise<void> {
    if (event.event === 'payment.captured') {
      const payment = record(nested(event, 'payload', 'payment', 'entity'));
      if (payment.currency !== 'INR') throw new Error('PAYMENT_MISMATCH');
      await tx.applyCapturedPayment({
        providerPaymentId: string(payment.id), razorpayOrderId: string(payment.order_id),
        amountPaise: bigint(payment.amount), currency: 'INR',
      });
      return;
    }
    if (event.event === 'payment.failed') {
      const payment = record(nested(event, 'payload', 'payment', 'entity'));
      await tx.applyFailedPayment({ razorpayOrderId: string(payment.order_id) });
      return;
    }
    if (event.event === 'refund.processed' || event.event === 'payment.dispute.created') {
      const entity = record(nested(event, 'payload', event.event === 'refund.processed' ? 'refund' : 'dispute', 'entity'));
      const reason = event.event === 'refund.processed' ? 'refunded' : 'charged_back';
      await tx.applyRefund({
        providerPaymentId: string(entity.payment_id),
        providerRefundId: string(entity.id),
        amountPaise: bigint(entity.amount), reason,
      });
      return;
    }
    throw new Error('UNSUPPORTED_WEBHOOK_EVENT');
  }
}
