import { ExtensionClient, type ExtensionClientOptions } from './client.js';
import { buildAuthorizationUrl, createPkcePair, parseCallback } from './pkce.js';

export type ExtensionSession = {
  accessToken: string;
  expiresAt: number;
};

export interface SessionStore {
  read(): Promise<ExtensionSession | null>;
  write(session: ExtensionSession): Promise<void>;
  clear(): Promise<void>;
}

export type BrowserAuth = {
  getRedirectURL(path?: string): string;
  launchWebAuthFlow(details: { url: string; interactive: boolean }): Promise<string>;
};

export type AuthOptions = {
  authorizeUrl: string;
  tokenUrl: string;
  clientId: string;
  scope: string;
  apiBaseUrl: string;
  productVersionId?: string;
  browserAuth: BrowserAuth;
  sessionStore: SessionStore;
  fetch: typeof fetch;
};

export class ExtensionAuth {
  constructor(private readonly options: AuthOptions) {}

  async signIn(): Promise<ExtensionSession> {
    const pair = await createPkcePair();
    const redirectUri = this.options.browserAuth.getRedirectURL('oauth/callback');
    const authorizeUrl = buildAuthorizationUrl({
      authorizeUrl: this.options.authorizeUrl,
      clientId: this.options.clientId,
      redirectUri,
      scope: this.options.scope,
      pair,
    });

    const callback = await this.options.browserAuth.launchWebAuthFlow({
      url: authorizeUrl,
      interactive: true,
    });
    const { code } = parseCallback(callback, pair.state);

    // The contract uses camelCase grantType/codeVerifier; verifier and code
    // exist only in this transient background scope and are never persisted.
    const response = await this.options.fetch(this.options.tokenUrl, {
      method: 'POST',
      credentials: 'omit',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({
        grantType: 'authorization_code',
        clientId: this.options.clientId,
        code,
        redirectUri,
        codeVerifier: pair.verifier,
      }),
    });
    if (!response.ok) throw new Error('OAUTH_EXCHANGE_FAILED');

    const body = (await response.json()) as { accessToken?: unknown; expiresIn?: unknown };
    if (typeof body.accessToken !== 'string' || typeof body.expiresIn !== 'number') {
      throw new Error('OAUTH_EXCHANGE_INVALID');
    }

    const session: ExtensionSession = {
      accessToken: body.accessToken,
      expiresAt: Date.now() + body.expiresIn * 1000,
    };
    await this.options.sessionStore.write(session);
    return session;
  }

  async signOut(): Promise<void> {
    await this.options.sessionStore.clear();
  }

  async client(): Promise<ExtensionClient> {
    const session = await this.options.sessionStore.read();
    if (!session || session.expiresAt <= Date.now()) {
      if (session) await this.options.sessionStore.clear();
      return new ExtensionClient(this.clientOptions(null));
    }
    return new ExtensionClient(this.clientOptions(session.accessToken));
  }

  private clientOptions(accessToken: string | null): ExtensionClientOptions {
    return {
      baseUrl: this.options.apiBaseUrl,
      accessToken,
      productVersionId: this.options.productVersionId,
      fetch: this.options.fetch,
    };
  }
}

export function createMemorySessionStore(): SessionStore {
  let session: ExtensionSession | null = null;
  return {
    async read() { return session ? { ...session } : null; },
    async write(value) { session = { ...value }; },
    async clear() { session = null; },
  };
}
