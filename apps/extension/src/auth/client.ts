import { ApiErrorSchema } from '@mark-1/contracts';

export type EntitlementLike = {
  productVersionId?: string;
  status?: string;
};

export type ExtensionClientOptions = {
  baseUrl: string;
  accessToken: string | null;
  fetch: typeof fetch;
  productVersionId?: string;
};

/**
 * Bearer-only API client. It deliberately sends no cookies and never persists
 * a response body in its own state.
 */
export class ExtensionClient {
  private readonly baseUrl: string;
  private readonly accessToken: string | null;
  private readonly fetcher: typeof fetch;
  private readonly productVersionId: string;

  constructor(options: ExtensionClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.accessToken = options.accessToken;
    this.fetcher = options.fetch;
    this.productVersionId = options.productVersionId ?? 'mark1-v1';
  }

  async entitlements(): Promise<EntitlementLike[]> {
    if (!this.accessToken) throw new Error('NOT_SIGNED_IN');

    const endpoint = new URL(`${this.baseUrl}/v1/entitlement`);
    endpoint.searchParams.set('productVersionId', this.productVersionId);

    const response = await this.fetcher(endpoint.toString(), {
      method: 'GET',
      credentials: 'omit',
      headers: {
        authorization: `Bearer ${this.accessToken}`,
        accept: 'application/json',
      },
    });

    if (!response.ok) {
      const parsed = ApiErrorSchema.safeParse(await response.json().catch(() => null));
      throw new Error(parsed.success ? parsed.data.code : 'API_UNAVAILABLE');
    }

    const body = (await response.json()) as { entitlements?: EntitlementLike[] };
    return Array.isArray(body.entitlements) ? body.entitlements : [];
  }

  async hasEntitlement(): Promise<boolean> {
    const entitlements = await this.entitlements();
    return entitlements.some(
      (entry) => entry.productVersionId === this.productVersionId && entry.status === 'active',
    );
  }
}
