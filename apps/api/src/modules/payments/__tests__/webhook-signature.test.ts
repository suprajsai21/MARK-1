import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { RazorpayEventVerifier } from '../signature.js';

describe('RazorpayEventVerifier', () => {
  it('accepts a valid HMAC over the exact raw body', () => {
    const rawBody = Buffer.from('{"event":"payment.captured"}');
    const signature = createHmac('sha256', 'test-secret').update(rawBody).digest('hex');
    const verifier = new RazorpayEventVerifier();
    expect(verifier.verify({ rawBody, signature, secret: 'test-secret' })).toEqual({ event: 'payment.captured' });
  });

  it('rejects missing, malformed, and mismatched signatures without parsing as trusted', () => {
    const rawBody = Buffer.from('{"event":"payment.captured"}');
    const verifier = new RazorpayEventVerifier();
    expect(() => verifier.verify({ rawBody, signature: '', secret: 'test-secret' })).toThrow('INVALID_WEBHOOK_SIGNATURE');
    expect(() => verifier.verify({ rawBody, signature: 'not-hex', secret: 'test-secret' })).toThrow('INVALID_WEBHOOK_SIGNATURE');
    expect(() => verifier.verify({ rawBody, signature: '0'.repeat(64), secret: 'test-secret' })).toThrow('INVALID_WEBHOOK_SIGNATURE');
  });

  it('rejects malformed signed JSON', () => {
    const rawBody = Buffer.from('{');
    const signature = createHmac('sha256', 'test-secret').update(rawBody).digest('hex');
    expect(() => new RazorpayEventVerifier().verify({ rawBody, signature, secret: 'test-secret' }))
      .toThrow('INVALID_WEBHOOK_PAYLOAD');
  });
});
