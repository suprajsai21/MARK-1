import { describe, expect, it, vi } from 'vitest';
import { HttpRazorpayClient } from '../razorpay-client.js';

describe('HttpRazorpayClient', () => {
  it('sends the server-side amount and credentials to the Razorpay Orders API', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ id: 'order_provider_1' }), { status: 200 }));
    const client = new HttpRazorpayClient({ keyId: 'key-id', keySecret: 'key-secret', fetcher });

    await expect(client.createOrder({ amountPaise: 19900n, currency: 'INR', receipt: 'order_internal_1' }))
      .resolves.toEqual({ id: 'order_provider_1' });

    expect(fetcher).toHaveBeenCalledWith('https://api.razorpay.com/v1/orders', expect.objectContaining({
      method: 'POST',
      headers: expect.objectContaining({
        authorization: `Basic ${Buffer.from('key-id:key-secret').toString('base64')}`,
        'content-type': 'application/json',
      }),
      body: JSON.stringify({ amount: 19900, currency: 'INR', receipt: 'order_internal_1' }),
    }));
  });

  it('rejects invalid amounts before making a provider request', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const client = new HttpRazorpayClient({ keyId: 'key-id', keySecret: 'key-secret', fetcher });
    await expect(client.createOrder({ amountPaise: 0n, currency: 'INR', receipt: 'receipt' }))
      .rejects.toThrow('INVALID_PROVIDER_AMOUNT');
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('rejects provider errors without exposing response details', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('private provider details', { status: 502 }));
    const client = new HttpRazorpayClient({ keyId: 'key-id', keySecret: 'key-secret', fetcher });
    await expect(client.createOrder({ amountPaise: 100n, currency: 'INR', receipt: 'receipt' }))
      .rejects.toThrow('RAZORPAY_ORDER_FAILED');
  });

  it('rejects malformed provider responses', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response(JSON.stringify({ status: 'created' }), { status: 200 }));
    const client = new HttpRazorpayClient({ keyId: 'key-id', keySecret: 'key-secret', fetcher });
    await expect(client.createOrder({ amountPaise: 100n, currency: 'INR', receipt: 'receipt' }))
      .rejects.toThrow('RAZORPAY_RESPONSE_INVALID');
  });
});
