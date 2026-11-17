export type Customer = { id: string; email: string; emailVerified: boolean; role: 'customer' | 'admin' };
export type AccountLink = { linkId: string; integrationId: string };

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

  async links(): Promise<{ links: AccountLink[] }> {
    return this.request('/v1/links');
  }

  async unlink(linkId: string, challengeId: string, proof: string): Promise<{ unlinked: true }> {
    return this.request(`/v1/links/${encodeURIComponent(linkId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ challengeId, proof }),
    });
  }
}
