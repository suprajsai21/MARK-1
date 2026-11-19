import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayEventVerifier } from '../signature.js';
import { WebhookService } from '../webhook-service.js';

const payload = {
  id: 'evt_1', event: 'payment.captured',
  payload: { payment: { entity: { id: 'pay_1', order_id: 'rzp_order_1', amount: 19900, currency: 'INR', status: 'captured' } } },
};
const rawBody = Buffer.from(JSON.stringify(payload));
const secret = 'webhook-secret';
const signature = createHmac('sha256', secret).update(rawBody).digest('hex');

function setup() {
  const events = new Set<string>();
  const calls: string[] = [];
  const service = new WebhookService({
    verifier: new RazorpayEventVerifier(),
    secret,
    database: {
      async processEvent(id, _eventType, _digest, apply) {
        if (events.has(id)) return false;
        const staged: string[] = [];
        await apply({
          async applyCapturedPayment(event) { staged.push(`capture:${event.providerPaymentId}`); },
          async applyFailedPayment(event) { staged.push(`failed:${event.razorpayOrderId}`); },
          async applyRefund(event) { staged.push(`refund:${event.providerRefundId}`); },
        });
        events.add(id);
        calls.push(...staged);
        return true;
      },
    },
  });
  return { service, calls };
}

describe('WebhookService', () => {
  it('records a verified event once and treats a replay as a no-op', async () => {
    const { service, calls } = setup();
    const input = { rawBody, signature };
    await expect(service.process(input)).resolves.toEqual({ accepted: true, duplicate: false });
    await expect(service.process(input)).resolves.toEqual({ accepted: true, duplicate: true });
    expect(calls).toEqual(['capture:pay_1']);
  });

  it('rejects invalid signatures before touching persistence', async () => {
    const { service, calls } = setup();
    await expect(service.process({ rawBody, signature: '0'.repeat(64) })).rejects.toThrow('INVALID_WEBHOOK_SIGNATURE');
    expect(calls).toEqual([]);
  });

  it('maps dispute entities to the purchased payment and dispute ID', async () => {
    const calls: Array<{ providerPaymentId: string; providerRefundId: string; amountPaise: bigint; reason: string }> = [];
    const service = new WebhookService({
      verifier: new RazorpayEventVerifier(),
      secret,
      database: {
        async processEvent(_id, _eventType, _digest, apply) {
          await apply({
            async applyCapturedPayment() {},
            async applyFailedPayment() {},
            async applyRefund(event) { calls.push(event); },
          });
          return true;
        },
      },
    });
    const disputeBody = Buffer.from(JSON.stringify({
      id: 'evt_dispute', event: 'payment.dispute.created',
      payload: { dispute: { entity: { id: 'disp_1', payment_id: 'pay_1', amount: 19900 } } },
    }));
    const disputeSignature = createHmac('sha256', secret).update(disputeBody).digest('hex');

    await expect(service.process({ rawBody: disputeBody, signature: disputeSignature }))
      .resolves.toMatchObject({ accepted: true, duplicate: false });
    expect(calls).toEqual([{ providerPaymentId: 'pay_1', providerRefundId: 'disp_1', amountPaise: 19900n, reason: 'charged_back' }]);
  });

  it('rejects unknown event payloads without applying payment state', async () => {
    const { service, calls } = setup();
    const body = Buffer.from(JSON.stringify({ id: 'evt_unknown', event: 'payment.captured' }));
    const sig = createHmac('sha256', secret).update(body).digest('hex');
    await expect(service.process({ rawBody: body, signature: sig })).rejects.toThrow('INVALID_WEBHOOK_PAYLOAD');
    expect(calls).toEqual([]);
  });
});
