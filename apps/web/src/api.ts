export type Customer = { id: string; email: string; emailVerified: boolean; role: 'customer' | 'admin' };
export type AccountLink = { linkId: string; integrationId: string };
export type PriceSnapshot = { productVersionId: string; amountPaise: number; currency: 'INR'; version: number };
export type CheckoutOrder = { orderId: string; amountPaise: string; currency: 'INR'; productVersionId: string; status: 'created' | 'paid' | 'failed' | 'refunded' | 'charged_back' };
export type CheckoutSession = { orderId: string; amountPaise: string; currency: 'INR'; productVersionId: string; razorpayOrderId: string; checkoutKeyId: string };
export type Entitlement = { productVersionId: string; status: 'active' | 'revoked' };

type Fetcher = typeof fetch;

export class PortalApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'PortalApiError';
  }
}

export class PortalApi {
  constructor(
    private readonly baseUrl = '',
    private readonly fetcher: Fetcher = fetch,
  ) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await this.fetcher(`${this.baseUrl}${path}`, {
      ...init,
      credentials: 'include',
      headers: {
        ...(init.body ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
    });
    const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new PortalApiError(
        typeof body.code === 'string' ? body.code : 'REQUEST_FAILED',
        typeof body.message === 'string' ? body.message : 'Request failed',
      );
    }
    return body as T;
  }

  async me(): Promise<{ user: Customer }> {
    return this.request('/v1/me');
  }

  async login(email: string, password: string): Promise<{ user: Customer }> {
    return this.request('/v1/auth/login', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async register(email: string, password: string): Promise<{ userId: string; verificationDispatchAttempted: true }> {
    return this.request('/v1/auth/register', { method: 'POST', body: JSON.stringify({ email, password }) });
  }

  async logout(): Promise<{ loggedOut: true }> {
    return this.request('/v1/auth/logout', { method: 'POST', body: JSON.stringify({}) });
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    return this.request('/v1/auth/verify-email', { method: 'POST', body: JSON.stringify({ token }) });
  }

  async resendVerification(email: string): Promise<{ accepted: true }> {
    return this.request('/v1/auth/verify-email/resend', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async requestPasswordReset(email: string): Promise<{ accepted: true }> {
    return this.request('/v1/auth/password/reset/request', { method: 'POST', body: JSON.stringify({ email }) });
  }

  async resetPassword(token: string, newPassword: string): Promise<{ changed: true }> {
    return this.request('/v1/auth/password/reset/complete', {
      method: 'POST',
      body: JSON.stringify({ token, newPassword }),
    });
  }

  /** Reads validated consent metadata. The server issues no code from this call. */
  async oauthConsentInfo(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state?: string;
  }): Promise<{ clientId: string; redirectUri: string; consentRequired: true }> {
    const query = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
      ...(input.state === undefined ? {} : { state: input.state }),
    });
    return this.request(`/v1/oauth/authorize?${query.toString()}`);
  }

  /** Explicit customer consent. Only this call may mint an authorization code. */
  async authorizeExtension(input: {
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    state?: string;
  }): Promise<{ redirectUrl: string }> {
    return this.request('/v1/oauth/authorize', {
      method: 'POST',
      body: JSON.stringify({ ...input, consented: true }),
    });
  }

  async links(): Promise<{ links: AccountLink[] }> {
    return this.request('/v1/links');
  }

  async currentPrice(): Promise<{ price: PriceSnapshot | null }> {
    return this.request('/v1/pricing/current');
  }

  async createCheckoutOrder(): Promise<CheckoutSession> {
    return this.request('/v1/checkout/orders', { method: 'POST', body: JSON.stringify({}) });
  }

  async checkoutOrder(orderId: string): Promise<{ order: CheckoutOrder }> {
    return this.request(`/v1/checkout/orders/${encodeURIComponent(orderId)}`);
  }

  async entitlements(): Promise<{ entitlements: Entitlement[] }> {
    return this.request('/v1/entitlement');
  }

  async setCurrentPrice(input: { productVersionId: string; amountPaise: number }): Promise<PriceSnapshot> {
    return this.request('/v1/admin/pricing/current', { method: 'PUT', body: JSON.stringify(input) });
  }

  async unlink(linkId: string, challengeId: string, proof: string): Promise<{ unlinked: true }> {
    return this.request(`/v1/links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ challengeId, proof }),
    });
  }
}
