import { randomUUID } from 'node:crypto';

export type MailAccountStatus = 'connected' | 'disconnected' | 'needs_reauth' | 'error';

export interface MailAccountRecord {
  id: string;
  userId: string;
  googleAccountId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: MailAccountStatus;
  scopes: string[];
  lastConnectedAt: Date | null;
  lastSyncAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface MailAccountSettingsRecord {
  mailAccountId: string;
  syncFrequencyMinutes: number;
  notifyOnSyncError: boolean;
  syncEnabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface MailAccountDetailRecord extends MailAccountRecord {
  settings: MailAccountSettingsRecord;
}

export interface MailOAuthCredentialRecord {
  mailAccountId: string;
  encryptedAccessToken: string;
  encryptedRefreshToken: string | null;
  tokenType: string;
  expiresAt: Date | null;
  keyVersion: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface MailAuditEventRecord {
  id: string;
  userId: string;
  mailAccountId: string | null;
  eventType: string;
  description: string;
  metadata: string | null;
  createdAt: Date;
}

export interface MailOAuthStateRecord {
  id: string;
  userId: string;
  stateHash: string;
  codeVerifier: string;
  redirectUri: string;
  targetAccountId: string | null;
  expiresAt: Date;
  createdAt: Date;
}

export interface MailDatabase {
  createOAuthState(input: {
    userId: string;
    stateHash: string;
    codeVerifier: string;
    redirectUri: string;
    targetAccountId?: string | null;
    expiresAt: Date;
  }): Promise<void>;

  consumeOAuthState(
    stateHash: string,
    now: Date,
  ): Promise<{
    userId: string;
    codeVerifier: string;
    redirectUri: string;
    targetAccountId: string | null;
  } | null>;

  countActiveAccounts(userId: string): Promise<number>;

  findAccountByGoogleId(userId: string, googleAccountId: string): Promise<MailAccountRecord | null>;

  findAccountByEmail(userId: string, email: string): Promise<MailAccountRecord | null>;

  findAccountById(userId: string, accountId: string): Promise<MailAccountDetailRecord | null>;

  listAccounts(userId: string): Promise<MailAccountRecord[]>;

  upsertAccountWithCredentials(input: {
    userId: string;
    googleAccountId: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    scopes: string[];
    encryptedAccessToken: string;
    encryptedRefreshToken?: string | null;
    tokenExpiresAt?: Date | null;
    targetAccountId?: string | null;
  }): Promise<MailAccountRecord>;

  disconnectAccount(userId: string, accountId: string): Promise<void>;

  updateAccountStatus(
    accountId: string,
    status: MailAccountStatus,
    errorMessage?: string | null,
    lastSyncAt?: Date | null,
  ): Promise<void>;

  updateAccountSettings(
    userId: string,
    accountId: string,
    settings: {
      syncFrequencyMinutes?: number | undefined;
      notifyOnSyncError?: boolean | undefined;
      syncEnabled?: boolean | undefined;
    },
  ): Promise<MailAccountSettingsRecord>;

  getAccountCredentials(
    userId: string,
    accountId: string,
  ): Promise<{
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
  } | null>;

  updateCredentials(
    accountId: string,
    encryptedAccessToken: string,
    encryptedRefreshToken?: string | null,
    expiresAt?: Date | null,
  ): Promise<void>;

  logAuditEvent(input: {
    userId: string;
    mailAccountId?: string | null;
    eventType: string;
    description: string;
    metadata?: string | null;
  }): Promise<void>;

  getRecentAuditEvents(userId: string, limit?: number): Promise<MailAuditEventRecord[]>;

  getOverviewStats(userId: string): Promise<{
    totalConnected: number;
    accountsNeedingAttention: number;
    activeAccounts: number;
    disconnectedAccounts: number;
    slotCapacity: number;
    slotsUsed: number;
    lastSyncAt: Date | null;
  }>;
}

export class MemoryMailDatabase implements MailDatabase {
  readonly accounts = new Map<string, MailAccountRecord>();
  readonly credentials = new Map<string, MailOAuthCredentialRecord>();
  readonly settings = new Map<string, MailAccountSettingsRecord>();
  readonly states = new Map<string, MailOAuthStateRecord>();
  readonly auditEvents: MailAuditEventRecord[] = [];

  async createOAuthState(input: {
    userId: string;
    stateHash: string;
    codeVerifier: string;
    redirectUri: string;
    targetAccountId?: string | null;
    expiresAt: Date;
  }): Promise<void> {
    const record: MailOAuthStateRecord = {
      id: randomUUID(),
      userId: input.userId,
      stateHash: input.stateHash,
      codeVerifier: input.codeVerifier,
      redirectUri: input.redirectUri,
      targetAccountId: input.targetAccountId ?? null,
      expiresAt: input.expiresAt,
      createdAt: new Date(),
    };
    this.states.set(input.stateHash, record);
  }

  async consumeOAuthState(
    stateHash: string,
    now: Date,
  ): Promise<{
    userId: string;
    codeVerifier: string;
    redirectUri: string;
    targetAccountId: string | null;
  } | null> {
    const state = this.states.get(stateHash);
    if (!state) return null;
    this.states.delete(stateHash);
    if (state.expiresAt <= now) return null;
    return {
      userId: state.userId,
      codeVerifier: state.codeVerifier,
      redirectUri: state.redirectUri,
      targetAccountId: state.targetAccountId,
    };
  }

  async countActiveAccounts(userId: string): Promise<number> {
    let count = 0;
    for (const account of this.accounts.values()) {
      if (account.userId === userId && account.status !== 'disconnected') {
        count++;
      }
    }
    return count;
  }

  async findAccountByGoogleId(userId: string, googleAccountId: string): Promise<MailAccountRecord | null> {
    for (const account of this.accounts.values()) {
      if (account.userId === userId && account.googleAccountId === googleAccountId) {
        return account;
      }
    }
    return null;
  }

  async findAccountByEmail(userId: string, email: string): Promise<MailAccountRecord | null> {
    const normalized = email.trim().toLowerCase();
    for (const account of this.accounts.values()) {
      if (account.userId === userId && account.email.toLowerCase() === normalized) {
        return account;
      }
    }
    return null;
  }

  async findAccountById(userId: string, accountId: string): Promise<MailAccountDetailRecord | null> {
    const account = this.accounts.get(accountId);
    if (!account || account.userId !== userId) return null;
    const setting = this.settings.get(accountId) ?? {
      mailAccountId: account.id,
      syncFrequencyMinutes: 15,
      notifyOnSyncError: true,
      syncEnabled: true,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
    return {
      ...account,
      settings: setting,
    };
  }

  async listAccounts(userId: string): Promise<MailAccountRecord[]> {
    const list: MailAccountRecord[] = [];
    for (const account of this.accounts.values()) {
      if (account.userId === userId) {
        list.push(account);
      }
    }
    return list.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  async upsertAccountWithCredentials(input: {
    userId: string;
    googleAccountId: string;
    email: string;
    displayName?: string | null;
    avatarUrl?: string | null;
    scopes: string[];
    encryptedAccessToken: string;
    encryptedRefreshToken?: string | null;
    tokenExpiresAt?: Date | null;
    targetAccountId?: string | null;
  }): Promise<MailAccountRecord> {
    const normalizedEmail = input.email.trim().toLowerCase();
    let accountId = input.targetAccountId;

    if (!accountId) {
      // Check if account already exists for this user by googleAccountId or email
      for (const acc of this.accounts.values()) {
        if (
          acc.userId === input.userId &&
          (acc.googleAccountId === input.googleAccountId || acc.email.toLowerCase() === normalizedEmail)
        ) {
          accountId = acc.id;
          break;
        }
      }
    }

    const now = new Date();
    let account: MailAccountRecord;

    if (accountId && this.accounts.has(accountId)) {
      const existing = this.accounts.get(accountId)!;
      account = {
        ...existing,
        googleAccountId: input.googleAccountId,
        email: normalizedEmail,
        displayName: input.displayName ?? existing.displayName,
        avatarUrl: input.avatarUrl ?? existing.avatarUrl,
        status: 'connected',
        scopes: input.scopes,
        lastConnectedAt: now,
        errorMessage: null,
        updatedAt: now,
      };
    } else {
      account = {
        id: randomUUID(),
        userId: input.userId,
        googleAccountId: input.googleAccountId,
        email: normalizedEmail,
        displayName: input.displayName ?? null,
        avatarUrl: input.avatarUrl ?? null,
        status: 'connected',
        scopes: input.scopes,
        lastConnectedAt: now,
        lastSyncAt: null,
        errorMessage: null,
        createdAt: now,
        updatedAt: now,
      };
    }

    this.accounts.set(account.id, account);

    // Save/update credentials
    const existingCreds = this.credentials.get(account.id);
    const credRecord: MailOAuthCredentialRecord = {
      mailAccountId: account.id,
      encryptedAccessToken: input.encryptedAccessToken,
      encryptedRefreshToken: input.encryptedRefreshToken ?? existingCreds?.encryptedRefreshToken ?? null,
      tokenType: 'Bearer',
      expiresAt: input.tokenExpiresAt ?? null,
      keyVersion: 1,
      createdAt: existingCreds?.createdAt ?? now,
      updatedAt: now,
    };
    this.credentials.set(account.id, credRecord);

    // Ensure default settings exist
    if (!this.settings.has(account.id)) {
      this.settings.set(account.id, {
        mailAccountId: account.id,
        syncFrequencyMinutes: 15,
        notifyOnSyncError: true,
        syncEnabled: true,
        createdAt: now,
        updatedAt: now,
      });
    }

    return account;
  }

  async disconnectAccount(userId: string, accountId: string): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account || account.userId !== userId) {
      throw new Error('ACCOUNT_NOT_FOUND');
    }

    account.status = 'disconnected';
    account.updatedAt = new Date();
    this.accounts.set(accountId, account);

    // Wipe stored credentials upon disconnect
    this.credentials.delete(accountId);
  }

  async updateAccountStatus(
    accountId: string,
    status: MailAccountStatus,
    errorMessage?: string | null,
    lastSyncAt?: Date | null,
  ): Promise<void> {
    const account = this.accounts.get(accountId);
    if (!account) return;
    account.status = status;
    if (errorMessage !== undefined) account.errorMessage = errorMessage;
    if (lastSyncAt !== undefined) account.lastSyncAt = lastSyncAt;
    account.updatedAt = new Date();
    this.accounts.set(accountId, account);
  }

  async updateAccountSettings(
    userId: string,
    accountId: string,
    updates: {
      syncFrequencyMinutes?: number;
      notifyOnSyncError?: boolean;
      syncEnabled?: boolean;
    },
  ): Promise<MailAccountSettingsRecord> {
    const account = this.accounts.get(accountId);
    if (!account || account.userId !== userId) {
      throw new Error('ACCOUNT_NOT_FOUND');
    }

    const current = this.settings.get(accountId) ?? {
      mailAccountId: accountId,
      syncFrequencyMinutes: 15,
      notifyOnSyncError: true,
      syncEnabled: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const updated: MailAccountSettingsRecord = {
      ...current,
      ...(updates.syncFrequencyMinutes !== undefined ? { syncFrequencyMinutes: updates.syncFrequencyMinutes } : {}),
      ...(updates.notifyOnSyncError !== undefined ? { notifyOnSyncError: updates.notifyOnSyncError } : {}),
      ...(updates.syncEnabled !== undefined ? { syncEnabled: updates.syncEnabled } : {}),
      updatedAt: new Date(),
    };

    this.settings.set(accountId, updated);
    return updated;
  }

  async getAccountCredentials(
    userId: string,
    accountId: string,
  ): Promise<{
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
  } | null> {
    const account = this.accounts.get(accountId);
    if (!account || account.userId !== userId) return null;
    const cred = this.credentials.get(accountId);
    if (!cred) return null;
    return {
      encryptedAccessToken: cred.encryptedAccessToken,
      encryptedRefreshToken: cred.encryptedRefreshToken,
      tokenExpiresAt: cred.expiresAt,
    };
  }

  async updateCredentials(
    accountId: string,
    encryptedAccessToken: string,
    encryptedRefreshToken?: string | null,
    expiresAt?: Date | null,
  ): Promise<void> {
    const cred = this.credentials.get(accountId);
    const now = new Date();
    this.credentials.set(accountId, {
      mailAccountId: accountId,
      encryptedAccessToken,
      encryptedRefreshToken: encryptedRefreshToken ?? cred?.encryptedRefreshToken ?? null,
      tokenType: 'Bearer',
      expiresAt: expiresAt !== undefined ? expiresAt : cred?.expiresAt ?? null,
      keyVersion: 1,
      createdAt: cred?.createdAt ?? now,
      updatedAt: now,
    });
  }

  async logAuditEvent(input: {
    userId: string;
    mailAccountId?: string | null;
    eventType: string;
    description: string;
    metadata?: string | null;
  }): Promise<void> {
    this.auditEvents.push({
      id: randomUUID(),
      userId: input.userId,
      mailAccountId: input.mailAccountId ?? null,
      eventType: input.eventType,
      description: input.description,
      metadata: input.metadata ?? null,
      createdAt: new Date(),
    });
  }

  async getRecentAuditEvents(userId: string, limit = 10): Promise<MailAuditEventRecord[]> {
    return this.auditEvents
      .filter((e) => e.userId === userId)
      .slice()
      .reverse()
      .slice(0, limit);
  }

  async getOverviewStats(userId: string): Promise<{
    totalConnected: number;
    accountsNeedingAttention: number;
    activeAccounts: number;
    disconnectedAccounts: number;
    slotCapacity: number;
    slotsUsed: number;
    lastSyncAt: Date | null;
  }> {
    let totalConnected = 0;
    let accountsNeedingAttention = 0;
    let activeAccounts = 0;
    let disconnectedAccounts = 0;
    let lastSyncAt: Date | null = null;

    for (const acc of this.accounts.values()) {
      if (acc.userId === userId) {
        if (acc.status === 'connected') {
          totalConnected++;
          activeAccounts++;
        } else if (acc.status === 'needs_reauth' || acc.status === 'error') {
          totalConnected++;
          accountsNeedingAttention++;
        } else if (acc.status === 'disconnected') {
          disconnectedAccounts++;
        }

        if (acc.lastSyncAt && (!lastSyncAt || acc.lastSyncAt > lastSyncAt)) {
          lastSyncAt = acc.lastSyncAt;
        }
      }
    }

    return {
      totalConnected,
      accountsNeedingAttention,
      activeAccounts,
      disconnectedAccounts,
      slotCapacity: 20,
      slotsUsed: activeAccounts + accountsNeedingAttention,
      lastSyncAt,
    };
  }
}
