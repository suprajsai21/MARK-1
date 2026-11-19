import { createHmac, timingSafeEqual } from 'node:crypto';

export type VerifiedRazorpayEvent = Record<string, unknown> & { event: string };

export class RazorpayEventVerifier {
  verify(input: { rawBody: Buffer; signature: string; secret: string }): VerifiedRazorpayEvent {
    const provided = input.signature;
    if (!/^[a-f0-9]{64}$/i.test(provided) || !input.secret) throw new Error('INVALID_WEBHOOK_SIGNATURE');
    const expected = createHmac('sha256', input.secret).update(input.rawBody).digest();
    const actual = Buffer.from(provided, 'hex');
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
      throw new Error('INVALID_WEBHOOK_SIGNATURE');
    }
    let payload: unknown;
    try {
      payload = JSON.parse(input.rawBody.toString('utf8'));
    } catch {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }
    if (typeof payload !== 'object' || payload === null || typeof (payload as { event?: unknown }).event !== 'string') {
      throw new Error('INVALID_WEBHOOK_PAYLOAD');
    }
    return payload as VerifiedRazorpayEvent;
  }
}
