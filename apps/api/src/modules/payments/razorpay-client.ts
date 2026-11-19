export interface RazorpayOrder {
  id: string;
}

export interface RazorpayClient {
  createOrder(input: { amountPaise: bigint; currency: 'INR'; receipt: string }): Promise<RazorpayOrder>;
}

/** Minimal server-side Razorpay Orders API adapter; secrets never leave the API. */
export class HttpRazorpayClient implements RazorpayClient {
  constructor(
    private readonly options: {
      keyId: string;
      keySecret: string;
      fetcher?: typeof fetch;
      apiBaseUrl?: string;
    },
  ) {}

  async createOrder(input: { amountPaise: bigint; currency: 'INR'; receipt: string }): Promise<RazorpayOrder> {
    if (input.amountPaise <= 0n || input.amountPaise > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error('INVALID_PROVIDER_AMOUNT');
    }
    const response = await (this.options.fetcher ?? fetch)(`${this.options.apiBaseUrl ?? 'https://api.razorpay.com/v1'}/orders`, {
      method: 'POST',
      headers: {
        authorization: `Basic ${Buffer.from(`${this.options.keyId}:${this.options.keySecret}`).toString('base64')}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ amount: Number(input.amountPaise), currency: input.currency, receipt: input.receipt }),
    });
    if (!response.ok) throw new Error('RAZORPAY_ORDER_FAILED');
    const payload: unknown = await response.json();
    if (typeof payload !== 'object' || payload === null || typeof (payload as { id?: unknown }).id !== 'string') {
      throw new Error('RAZORPAY_RESPONSE_INVALID');
    }
    return { id: (payload as { id: string }).id };
  }
}
