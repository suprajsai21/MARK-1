import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const AUTHORIZATION_CODE_TTL_MS = 5 * 60_000;
export const ACCESS_TOKEN_TTL_SECONDS = 900;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60_000;

export type OAuthStore = {
  createAuthorizationCode(record: {
    codeHash: string;
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  }): Promise<void>;
  consumeAuthorizationCode(codeHash: string, now: Date): Promise<{
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  } | null>;
  createTokenFamily(record: {
    familyId: string;
    userId: string;
    clientId: string;
    accessTokenHash: string;
    accessExpiresAt: Date;
    refreshTokenHash: string;
    refreshExpiresAt: Date;
  }): Promise<void>;
  rotateRefreshToken(record: {
    refreshTokenHash: string;
    now: Date;
    accessTokenHash: string;
    accessExpiresAt: Date;
    nextRefreshTokenHash: string;
    refreshExpiresAt: Date;
  }): Promise<'rotated' | 'reused' | 'invalid'>;
  findAccessToken(accessTokenHash: string): Promise<{
    familyId: string;
    userId: string;
    clientId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null>;
  revokeTokenFamilyByTokenHash(tokenHash: string, now: Date): Promise<boolean>;
};

export class OAuthError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'OAuthError';
  }
}

export type OAuthTokenResponse = {
  accessToken: string;
  expiresIn: 900;
  refreshToken: string;
};

export class OAuthService {
  readonly clientId: string;
  readonly redirectUris: readonly string[];

  constructor(private readonly options: {
    store: OAuthStore;
    clientId: string;
    redirectUris: readonly string[];
    now?: () => Date;
  }) {
    this.clientId = options.clientId;
    this.redirectUris = options.redirectUris;
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  /** Exact-match checks the consent screen performs before rendering anything. */
  validateAuthorizationRequest(input: { clientId: string; redirectUri: string }): void {
    this.assertClient(input.clientId);
    this.assertRedirectUri(input.redirectUri);
  }

  async createAuthorizationCode(input: {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    consented: true;
    state?: string;
  }): Promise<{ redirectUrl: string }> {
    this.assertClient(input.clientId);
    this.assertRedirectUri(input.redirectUri);
    if (input.consented !== true) throw new OAuthError('CONSENT_REQUIRED');
    if (!/^[A-Za-z0-9_-]{43}$/.test(input.codeChallenge)) throw new OAuthError('INVALID_REQUEST');
    if (input.state !== undefined && (input.state.length > 512 || [...input.state].some((character) => {
      const code = character.charCodeAt(0);
      return code < 0x20 || code === 0x7f;
    }))) {
      throw new OAuthError('INVALID_REQUEST');
    }

    const code = newOpaqueToken();
    await this.options.store.createAuthorizationCode({
      codeHash: tokenHash(code),
      userId: input.userId,
      clientId: input.clientId,
      redirectUri: input.redirectUri,
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(this.now().getTime() + AUTHORIZATION_CODE_TTL_MS),
    });

    const redirect = new URL(input.redirectUri);
    redirect.searchParams.set('code', code);
    if (input.state !== undefined) redirect.searchParams.set('state', input.state);
    return { redirectUrl: redirect.toString() };
  }

  async exchange(input: {
    code: string;
    clientId: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<OAuthTokenResponse> {
    this.assertClient(input.clientId);
    this.assertRedirectUri(input.redirectUri);
    if (!isValidVerifier(input.codeVerifier)) throw new OAuthError('INVALID_GRANT');

    const record = await this.options.store.consumeAuthorizationCode(tokenHash(input.code), this.now());
    if (!record || record.clientId !== input.clientId || record.redirectUri !== input.redirectUri) {
      throw new OAuthError('INVALID_GRANT');
    }

    const challenge = Buffer.from(record.codeChallenge, 'base64url');
    const actual = Buffer.from(pkceChallenge(input.codeVerifier), 'base64url');
    if (challenge.length !== actual.length || !timingSafeEqual(challenge, actual)) {
      throw new OAuthError('INVALID_GRANT');
    }

    return this.issueTokenFamily(record.userId, record.clientId);
  }

  async exchangeRefresh(input: { refreshToken: string; clientId: string }): Promise<OAuthTokenResponse> {
    this.assertClient(input.clientId);
    const accessToken = newOpaqueToken();
    const refreshToken = newOpaqueToken();
    const now = this.now();
    const result = await this.options.store.rotateRefreshToken({
      refreshTokenHash: tokenHash(input.refreshToken),
      now,
      accessTokenHash: tokenHash(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      nextRefreshTokenHash: tokenHash(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    if (result !== 'rotated') throw new OAuthError('INVALID_GRANT');
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }

  async authenticateAccessToken(rawToken: string): Promise<{ userId: string; clientId: string }> {
    if (!rawToken || rawToken.length > 512) throw new OAuthError('INVALID_TOKEN');
    const row = await this.options.store.findAccessToken(tokenHash(rawToken));
    if (!row || row.revokedAt !== null || row.expiresAt <= this.now()) throw new OAuthError('INVALID_TOKEN');
    return { userId: row.userId, clientId: row.clientId };
  }

  async revoke(input: { token: string; clientId: string }): Promise<{ revoked: true }> {
    this.assertClient(input.clientId);
    if (input.token && input.token.length <= 512) {
      await this.options.store.revokeTokenFamilyByTokenHash(tokenHash(input.token), this.now());
    }
    // OAuth revocation deliberately returns the same result for unknown tokens.
    return { revoked: true };
  }

  private async issueTokenFamily(userId: string, clientId: string): Promise<OAuthTokenResponse> {
    const accessToken = newOpaqueToken();
    const refreshToken = newOpaqueToken();
    const now = this.now();
    await this.options.store.createTokenFamily({
      familyId: randomBytes(16).toString('hex'),
      userId,
      clientId,
      accessTokenHash: tokenHash(accessToken),
      accessExpiresAt: new Date(now.getTime() + ACCESS_TOKEN_TTL_SECONDS * 1000),
      refreshTokenHash: tokenHash(refreshToken),
      refreshExpiresAt: new Date(now.getTime() + REFRESH_TOKEN_TTL_MS),
    });
    return { accessToken, expiresIn: ACCESS_TOKEN_TTL_SECONDS, refreshToken };
  }

  private assertClient(clientId: string): void {
    if (clientId !== this.options.clientId) throw new OAuthError('INVALID_CLIENT');
  }

  private assertRedirectUri(redirectUri: string): void {
    if (!this.options.redirectUris.includes(redirectUri)) throw new OAuthError('INVALID_REDIRECT_URI');
  }
}

export function tokenHash(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function pkceChallenge(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

function newOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

function isValidVerifier(verifier: string): boolean {
  return verifier.length >= 43 && verifier.length <= 128 && /^[A-Za-z0-9._~-]+$/.test(verifier);
}
