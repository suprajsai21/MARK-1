import { createHash, randomBytes } from 'node:crypto';
import type {
  AuthUser,
  CompleteMailOAuthInput,
  DisconnectMailAccountInput,
  MailAccountDetail,
  MailAccountSettings,
  MailAccountSummary,
  MailHealthCheckResponse,
  MailOverview,
  MailSettings,
  UpdateMailAccountSettingsInput,
} from '@mark-1/contracts';
import type {
  MailAccountRecord,
  MailAccountStatus,
  MailDatabase,
} from '@mark-1/db';
import { decryptToken, encryptToken } from '@mark-1/db';
import type { GoogleOAuthClient } from './google-client.js';

export class MailError extends Error {
  constructor(
    readonly code:
      | 'UNAUTHENTICATED'
      | 'ACCOUNT_NOT_FOUND'
      | 'ACCOUNT_FORBIDDEN'
      | 'CAPACITY_EXCEEDED'
      | 'ACCOUNT_ALREADY_CONNECTED'
      | 'INVALID_STATE'
      | 'OAUTH_DENIED'
      | 'TOKEN_EXCHANGE_FAILED'
      | 'HEALTH_CHECK_FAILED'
      | 'CONFIRM_EMAIL_MISMATCH'
      | 'CREDENTIALS_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'MailError';
  }
}

export interface MailServiceOptions {
  database: MailDatabase;
  googleClient: GoogleOAuthClient;
  encryptionKey: Buffer;
  clientId: string;
  clientSecret: string;
  defaultRedirectUri: string;
  maxAccountsPerUser?: number;
}

export class MailService {
  private readonly maxAccounts: number;

  constructor(private readonly options: MailServiceOptions) {
    this.maxAccounts = options.maxAccountsPerUser ?? 20;
  }

  async getOverview(actor: AuthUser | null): Promise<MailOverview> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    const stats = await this.options.database.getOverviewStats(actor.id);
    const audits = await this.options.database.getRecentAuditEvents(actor.id, 10);

    return {
      totalConnected: stats.totalConnected,
      accountsNeedingAttention: stats.accountsNeedingAttention,
      activeAccounts: stats.activeAccounts,
      disconnectedAccounts: stats.disconnectedAccounts,
      slotCapacity: this.maxAccounts,
      slotsUsed: stats.slotsUsed,
      lastSyncAt: stats.lastSyncAt ? stats.lastSyncAt.toISOString() : null,
      modulesAvailability: {
        mail: true,
        inbox: 'phase2_preview',
        compose: 'phase3_preview',
        queue: 'phase4_preview',
        templates: 'phase1_ready',
        drafts: 'phase1_ready',
      },
      recentActivity: audits.map((a) => ({
        id: a.id,
        eventType: a.eventType,
        description: a.description,
        createdAt: a.createdAt.toISOString(),
        mailAccountId: a.mailAccountId,
      })),
    };
  }

  async listAccounts(actor: AuthUser | null): Promise<MailAccountSummary[]> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');
    const records = await this.options.database.listAccounts(actor.id);
    return records.map(toSummary);
  }

  async getAccount(actor: AuthUser | null, accountId: string): Promise<MailAccountDetail> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');
    const detail = await this.options.database.findAccountById(actor.id, accountId);
    if (!detail) throw new MailError('ACCOUNT_NOT_FOUND', 'Mail account not found');

    return {
      ...toSummary(detail),
      settings: {
        syncFrequencyMinutes: detail.settings.syncFrequencyMinutes,
        notifyOnSyncError: detail.settings.notifyOnSyncError,
        syncEnabled: detail.settings.syncEnabled,
      },
    };
  }

  async initiateConnect(
    actor: AuthUser | null,
    redirectUrl?: string,
    targetAccountId?: string,
  ): Promise<{ authorizationUrl: string; state: string }> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    // If adding a new account, check capacity
    if (!targetAccountId) {
      const activeCount = await this.options.database.countActiveAccounts(actor.id);
      if (activeCount >= this.maxAccounts) {
        throw new MailError(
          'CAPACITY_EXCEEDED',
          `Account capacity limit of ${this.maxAccounts} accounts reached. Disconnect an account to add a new one.`,
        );
      }
    } else {
      const existing = await this.options.database.findAccountById(actor.id, targetAccountId);
      if (!existing) {
        throw new MailError('ACCOUNT_NOT_FOUND', 'Target mail account for reconnect not found');
      }
    }

    const state = randomBytes(32).toString('hex');
    const stateHash = createHash('sha256').update(state).digest('hex');

    // PKCE code verifier and challenge
    const codeVerifier = randomBytes(32).toString('base64url');
    const codeChallenge = createHash('sha256').update(codeVerifier).digest('base64url');

    const effectiveRedirectUri = redirectUrl?.trim() || this.options.defaultRedirectUri;
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes TTL

    await this.options.database.createOAuthState({
      userId: actor.id,
      stateHash,
      codeVerifier,
      redirectUri: effectiveRedirectUri,
      targetAccountId: targetAccountId ?? null,
      expiresAt,
    });

    const authorizationUrl = this.options.googleClient.generateAuthorizationUrl({
      clientId: this.options.clientId,
      redirectUri: effectiveRedirectUri,
      state,
      codeChallenge,
    });

    return { authorizationUrl, state };
  }

  async completeCallback(
    actor: AuthUser | null,
    input: CompleteMailOAuthInput,
  ): Promise<MailAccountSummary> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    const stateHash = createHash('sha256').update(input.state).digest('hex');
    const oauthState = await this.options.database.consumeOAuthState(stateHash, new Date());

    if (!oauthState) {
      throw new MailError('INVALID_STATE', 'Invalid, expired, or previously consumed OAuth state');
    }

    if (oauthState.userId !== actor.id) {
      throw new MailError('INVALID_STATE', 'OAuth state does not match authenticated user session');
    }

    // Exchange authorization code for tokens
    let tokenResponse;
    try {
      tokenResponse = await this.options.googleClient.exchangeAuthorizationCode({
        code: input.code,
        clientId: this.options.clientId,
        clientSecret: this.options.clientSecret,
        redirectUri: oauthState.redirectUri,
        codeVerifier: oauthState.codeVerifier,
      });
    } catch (err) {
      throw new MailError(
        'TOKEN_EXCHANGE_FAILED',
        err instanceof Error ? err.message : 'Google OAuth code exchange failed',
      );
    }

    // Fetch Google profile
    const userInfo = await this.options.googleClient.fetchUserInfo(tokenResponse.accessToken);

    // If not a reconnect of a known target account, check if new account exceeds capacity
    if (!oauthState.targetAccountId) {
      const existingGoogle = await this.options.database.findAccountByGoogleId(actor.id, userInfo.id);
      const existingEmail = await this.options.database.findAccountByEmail(actor.id, userInfo.email);

      if (!existingGoogle && !existingEmail) {
        const activeCount = await this.options.database.countActiveAccounts(actor.id);
        if (activeCount >= this.maxAccounts) {
          throw new MailError(
            'CAPACITY_EXCEEDED',
            `Account capacity limit of ${this.maxAccounts} accounts reached.`,
          );
        }
      }
    }

    // Encrypt access and refresh tokens
    const encryptedAccessToken = encryptToken(tokenResponse.accessToken, this.options.encryptionKey);
    const encryptedRefreshToken = tokenResponse.refreshToken
      ? encryptToken(tokenResponse.refreshToken, this.options.encryptionKey)
      : null;

    const tokenExpiresAt = tokenResponse.expiresIn
      ? new Date(Date.now() + tokenResponse.expiresIn * 1000)
      : null;

    const scopes = tokenResponse.scope ? tokenResponse.scope.split(' ') : ['openid', 'email'];

    const account = await this.options.database.upsertAccountWithCredentials({
      userId: actor.id,
      googleAccountId: userInfo.id,
      email: userInfo.email,
      displayName: userInfo.name ?? null,
      avatarUrl: userInfo.picture ?? null,
      scopes,
      encryptedAccessToken,
      encryptedRefreshToken,
      tokenExpiresAt,
      targetAccountId: oauthState.targetAccountId ?? null,
    });

    await this.options.database.logAuditEvent({
      userId: actor.id,
      mailAccountId: account.id,
      eventType: oauthState.targetAccountId ? 'account_reconnected' : 'account_connected',
      description: `Gmail account ${account.email} successfully ${oauthState.targetAccountId ? 'reconnected' : 'connected'}.`,
    });

    return toSummary(account);
  }

  async checkAccountHealth(actor: AuthUser | null, accountId: string): Promise<MailHealthCheckResponse> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    const account = await this.options.database.findAccountById(actor.id, accountId);
    if (!account) throw new MailError('ACCOUNT_NOT_FOUND', 'Mail account not found');

    const nowIso = new Date().toISOString();

    if (account.status === 'disconnected') {
      return {
        accountId,
        status: 'disconnected',
        healthy: false,
        message: 'Account is disconnected',
        checkedAt: nowIso,
        lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
      };
    }

    const creds = await this.options.database.getAccountCredentials(actor.id, accountId);
    if (!creds) {
      await this.options.database.updateAccountStatus(
        accountId,
        'needs_reauth',
        'OAuth credentials missing or expired. Re-authorization required.',
      );
      return {
        accountId,
        status: 'needs_reauth',
        healthy: false,
        message: 'OAuth credentials missing or expired. Re-authorization required.',
        checkedAt: nowIso,
        lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
      };
    }

    let accessToken: string;
    try {
      accessToken = decryptToken(creds.encryptedAccessToken, this.options.encryptionKey);
    } catch {
      await this.options.database.updateAccountStatus(
        accountId,
        'error',
        'Stored credential decryption failed.',
      );
      return {
        accountId,
        status: 'error',
        healthy: false,
        message: 'Decryption failed for stored credentials.',
        checkedAt: nowIso,
        lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
      };
    }

    // Check if token is expired or expires in < 2 minutes
    const isExpired = creds.tokenExpiresAt && creds.tokenExpiresAt.getTime() <= Date.now() + 120_000;
    if (isExpired && creds.encryptedRefreshToken) {
      try {
        const refreshToken = decryptToken(creds.encryptedRefreshToken, this.options.encryptionKey);
        const refreshed = await this.options.googleClient.refreshAccessToken({
          refreshToken,
          clientId: this.options.clientId,
          clientSecret: this.options.clientSecret,
        });

        accessToken = refreshed.accessToken;
        const newEncryptedAccess = encryptToken(refreshed.accessToken, this.options.encryptionKey);
        const newExpiresAt = refreshed.expiresIn ? new Date(Date.now() + refreshed.expiresIn * 1000) : null;

        await this.options.database.updateCredentials(
          accountId,
          newEncryptedAccess,
          undefined,
          newExpiresAt,
        );

        await this.options.database.logAuditEvent({
          userId: actor.id,
          mailAccountId: accountId,
          eventType: 'token_refreshed',
          description: `OAuth access token refreshed for ${account.email}.`,
        });
      } catch (refreshErr) {
        const errMsg = refreshErr instanceof Error ? refreshErr.message : 'Token refresh failed';
        const isRevoked = errMsg.includes('invalid_grant');
        const nextStatus: MailAccountStatus = isRevoked ? 'needs_reauth' : 'error';
        const statusMsg = isRevoked
          ? 'Google authorization was revoked or expired. Please reconnect.'
          : `Token refresh failed: ${errMsg}`;

        await this.options.database.updateAccountStatus(accountId, nextStatus, statusMsg);

        return {
          accountId,
          status: nextStatus,
          healthy: false,
          message: statusMsg,
          checkedAt: nowIso,
          lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
        };
      }
    }

    // Verify Gmail API profile
    try {
      await this.options.googleClient.checkGmailProfile(accessToken);
      const syncTime = new Date();
      await this.options.database.updateAccountStatus(accountId, 'connected', null, syncTime);

      await this.options.database.logAuditEvent({
        userId: actor.id,
        mailAccountId: accountId,
        eventType: 'connection_checked',
        description: `Connection verified for ${account.email}.`,
      });

      return {
        accountId,
        status: 'connected',
        healthy: true,
        message: 'Account connection verified and healthy.',
        checkedAt: syncTime.toISOString(),
        lastSyncAt: syncTime.toISOString(),
      };
    } catch (apiErr) {
      const errMsg = apiErr instanceof Error ? apiErr.message : 'Gmail API call failed';
      await this.options.database.updateAccountStatus(
        accountId,
        'error',
        `Gmail API verification failed: ${errMsg}`,
      );

      return {
        accountId,
        status: 'error',
        healthy: false,
        message: `Gmail API check failed: ${errMsg}`,
        checkedAt: nowIso,
        lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
      };
    }
  }

  async disconnectAccount(
    actor: AuthUser | null,
    accountId: string,
    input?: DisconnectMailAccountInput,
  ): Promise<{ disconnected: true }> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    const account = await this.options.database.findAccountById(actor.id, accountId);
    if (!account) throw new MailError('ACCOUNT_NOT_FOUND', 'Mail account not found');

    if (input?.confirmEmail) {
      if (input.confirmEmail.trim().toLowerCase() !== account.email.toLowerCase()) {
        throw new MailError(
          'CONFIRM_EMAIL_MISMATCH',
          `Confirmation email does not match account email (${account.email}).`,
        );
      }
    }

    // Best-effort provider token revocation
    const creds = await this.options.database.getAccountCredentials(actor.id, accountId);
    if (creds) {
      try {
        const token = creds.encryptedRefreshToken
          ? decryptToken(creds.encryptedRefreshToken, this.options.encryptionKey)
          : decryptToken(creds.encryptedAccessToken, this.options.encryptionKey);
        await this.options.googleClient.revokeToken(token);
      } catch {
        // Continue disconnecting locally even if Google revoke endpoint fails
      }
    }

    await this.options.database.disconnectAccount(actor.id, accountId);

    await this.options.database.logAuditEvent({
      userId: actor.id,
      mailAccountId: accountId,
      eventType: 'account_disconnected',
      description: `Gmail account ${account.email} disconnected and credentials purged.`,
    });

    return { disconnected: true };
  }

  async updateSettings(
    actor: AuthUser | null,
    accountId: string,
    settings: UpdateMailAccountSettingsInput,
  ): Promise<MailAccountSettings> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    const existing = await this.options.database.findAccountById(actor.id, accountId);
    if (!existing) throw new MailError('ACCOUNT_NOT_FOUND', 'Mail account not found');

    const updated = await this.options.database.updateAccountSettings(actor.id, accountId, {
      ...(settings.syncFrequencyMinutes !== undefined ? { syncFrequencyMinutes: settings.syncFrequencyMinutes } : {}),
      ...(settings.notifyOnSyncError !== undefined ? { notifyOnSyncError: settings.notifyOnSyncError } : {}),
      ...(settings.syncEnabled !== undefined ? { syncEnabled: settings.syncEnabled } : {}),
    });

    await this.options.database.logAuditEvent({
      userId: actor.id,
      mailAccountId: accountId,
      eventType: 'settings_updated',
      description: 'Account synchronization settings updated.',
    });

    return {
      syncFrequencyMinutes: updated.syncFrequencyMinutes,
      notifyOnSyncError: updated.notifyOnSyncError,
      syncEnabled: updated.syncEnabled,
    };
  }

  async getMailSettings(actor: AuthUser | null): Promise<MailSettings> {
    if (!actor) throw new MailError('UNAUTHENTICATED', 'Authentication required');

    const stats = await this.options.database.getOverviewStats(actor.id);

    return {
      slotCapacity: this.maxAccounts,
      slotsUsed: stats.slotsUsed,
      defaultSyncFrequencyMinutes: 15,
      encryptionStatus: 'AES-256-GCM authenticated encryption active',
      gmailScopeLevel: 'read_only',
    };
  }
}

function toSummary(account: MailAccountRecord): MailAccountSummary {
  return {
    id: account.id,
    email: account.email,
    displayName: account.displayName,
    avatarUrl: account.avatarUrl,
    status: account.status,
    scopes: account.scopes,
    lastConnectedAt: account.lastConnectedAt ? account.lastConnectedAt.toISOString() : null,
    lastSyncAt: account.lastSyncAt ? account.lastSyncAt.toISOString() : null,
    errorMessage: account.errorMessage,
    createdAt: account.createdAt.toISOString(),
    updatedAt: account.updatedAt.toISOString(),
  };
}
