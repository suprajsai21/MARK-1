export const GMAIL_READONLY_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const USERINFO_EMAIL_SCOPE = 'https://www.googleapis.com/auth/userinfo.email';
export const USERINFO_PROFILE_SCOPE = 'https://www.googleapis.com/auth/userinfo.profile';
export const OPENID_SCOPE = 'openid';

export const MINIMAL_GMAIL_SCOPES = [
  OPENID_SCOPE,
  USERINFO_EMAIL_SCOPE,
  USERINFO_PROFILE_SCOPE,
  GMAIL_READONLY_SCOPE,
] as const;

export interface GoogleUserInfo {
  id: string;
  email: string;
  name?: string | null;
  picture?: string | null;
}

export interface GoogleTokenResponse {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  tokenType?: string | null;
  scope?: string | null;
}

export interface GoogleGmailProfile {
  emailAddress: string;
  messagesTotal?: number | undefined;
  threadsTotal?: number | undefined;
  historyId?: string | undefined;
}

export interface GoogleOAuthClient {
  generateAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string;

  exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleTokenResponse>;

  fetchUserInfo(accessToken: string): Promise<GoogleUserInfo>;

  refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn?: number | null; scope?: string | null }>;

  revokeToken(token: string): Promise<void>;

  checkGmailProfile(accessToken: string): Promise<GoogleGmailProfile>;
}

export class FetchGoogleOAuthClient implements GoogleOAuthClient {
  constructor(private readonly fetcher: typeof fetch = fetch) {}

  generateAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: MINIMAL_GMAIL_SCOPES.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: input.state,
      code_challenge: input.codeChallenge,
      code_challenge_method: 'S256',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleTokenResponse> {
    const body = new URLSearchParams({
      code: input.code,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      redirect_uri: input.redirectUri,
      grant_type: 'authorization_code',
      code_verifier: input.codeVerifier,
    });

    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof data.error_description === 'string'
          ? data.error_description
          : typeof data.error === 'string'
            ? data.error
            : 'TOKEN_EXCHANGE_FAILED',
      );
    }

    return {
      accessToken: String(data.access_token),
      refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : null,
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
      tokenType: typeof data.token_type === 'string' ? data.token_type : 'Bearer',
      scope: typeof data.scope === 'string' ? data.scope : null,
    };
  }

  async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const response = await this.fetcher('https://www.googleapis.com/oauth2/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error('FAILED_FETCHING_USERINFO');
    }

    if (!data.id || !data.email) {
      throw new Error('INVALID_USERINFO_PAYLOAD');
    }

    return {
      id: String(data.id),
      email: String(data.email),
      name: typeof data.name === 'string' ? data.name : null,
      picture: typeof data.picture === 'string' ? data.picture : null,
    };
  }

  async refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn?: number | null; scope?: string | null }> {
    const body = new URLSearchParams({
      refresh_token: input.refreshToken,
      client_id: input.clientId,
      client_secret: input.clientSecret,
      grant_type: 'refresh_token',
    });

    const response = await this.fetcher('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error(
        typeof data.error_description === 'string'
          ? data.error_description
          : typeof data.error === 'string'
            ? data.error
            : 'TOKEN_REFRESH_FAILED',
      );
    }

    return {
      accessToken: String(data.access_token),
      expiresIn: typeof data.expires_in === 'number' ? data.expires_in : null,
      scope: typeof data.scope === 'string' ? data.scope : null,
    };
  }

  async revokeToken(token: string): Promise<void> {
    const response = await this.fetcher(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      },
    );
    // Google returns 200 on success. If token is already invalid, it might return 400.
    // We treat revoke as best-effort on provider side.
    if (!response.ok && response.status !== 400) {
      throw new Error('REVOCATION_FAILED');
    }
  }

  async checkGmailProfile(accessToken: string): Promise<GoogleGmailProfile> {
    const response = await this.fetcher('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
    if (!response.ok) {
      throw new Error('GMAIL_API_CALL_FAILED');
    }

    return {
      emailAddress: String(data.emailAddress),
      messagesTotal: typeof data.messagesTotal === 'number' ? data.messagesTotal : 0,
      threadsTotal: typeof data.threadsTotal === 'number' ? data.threadsTotal : 0,
      historyId: typeof data.historyId === 'string' ? data.historyId : undefined,
    };
  }
}

export class MockGoogleOAuthClient implements GoogleOAuthClient {
  readonly exchangeResponses = new Map<string, GoogleTokenResponse>();
  readonly userInfos = new Map<string, GoogleUserInfo>();
  readonly revokedTokens = new Set<string>();
  profileCheckFails = false;
  refreshFails = false;

  generateAuthorizationUrl(input: {
    clientId: string;
    redirectUri: string;
    state: string;
    codeChallenge: string;
  }): string {
    const params = new URLSearchParams({
      client_id: input.clientId,
      redirect_uri: input.redirectUri,
      response_type: 'code',
      scope: MINIMAL_GMAIL_SCOPES.join(' '),
      state: input.state,
      code_challenge: input.codeChallenge,
    });
    return `https://mock.google.auth/auth?${params.toString()}`;
  }

  async exchangeAuthorizationCode(input: {
    code: string;
    clientId: string;
    clientSecret: string;
    redirectUri: string;
    codeVerifier: string;
  }): Promise<GoogleTokenResponse> {
    const res = this.exchangeResponses.get(input.code);
    if (!res) {
      throw new Error('invalid_grant: code not found or expired');
    }
    return res;
  }

  async fetchUserInfo(accessToken: string): Promise<GoogleUserInfo> {
    const info = this.userInfos.get(accessToken);
    if (!info) {
      throw new Error('userinfo not found for access token');
    }
    return info;
  }

  async refreshAccessToken(input: {
    refreshToken: string;
    clientId: string;
    clientSecret: string;
  }): Promise<{ accessToken: string; expiresIn?: number | null; scope?: string | null }> {
    void input;
    if (this.refreshFails) {
      throw new Error('invalid_grant: refresh token revoked');
    }
    return {
      accessToken: `mock_refreshed_access_${Date.now()}`,
      expiresIn: 3600,
      scope: MINIMAL_GMAIL_SCOPES.join(' '),
    };
  }

  async revokeToken(token: string): Promise<void> {
    this.revokedTokens.add(token);
  }

  async checkGmailProfile(accessToken: string): Promise<GoogleGmailProfile> {
    if (this.profileCheckFails) {
      throw new Error('Gmail API profile check failed');
    }
    const info = this.userInfos.get(accessToken);
    return {
      emailAddress: info?.email ?? 'mock.gmail@test.example',
      messagesTotal: 42,
      threadsTotal: 10,
    };
  }
}
