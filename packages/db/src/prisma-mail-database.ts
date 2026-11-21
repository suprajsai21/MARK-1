import type {
  MailAccountDetailRecord,
  MailAccountRecord,
  MailAccountSettingsRecord,
  MailAccountStatus,
  MailAuditEventRecord,
  MailDatabase,
} from './mail-database.js';

export interface PrismaMailAccountRow {
  id: string;
  userId: string;
  googleAccountId: string;
  email: string;
  displayName: string | null;
  avatarUrl: string | null;
  status: MailAccountStatus;
  scopes: string;
  lastConnectedAt: Date | null;
  lastSyncAt: Date | null;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
  settings?: {
    mailAccountId: string;
    syncFrequencyMinutes: number;
    notifyOnSyncError: boolean;
    syncEnabled: boolean;
    createdAt: Date;
    updatedAt: Date;
  } | null;
}

export interface PrismaMailDatabaseClient {
  mailOAuthState: {
    create(args: {
      data: {
        userId: string;
        stateHash: string;
        codeVerifier: string;
        redirectUri: string;
        targetAccountId?: string | null;
        expiresAt: Date;
      };
    }): Promise<unknown>;
    findUnique(args: { where: { stateHash: string } }): Promise<{
      userId: string;
      codeVerifier: string;
      redirectUri: string;
      targetAccountId: string | null;
      expiresAt: Date;
    } | null>;
    delete(args: { where: { stateHash: string } }): Promise<unknown>;
  };
  mailAccount: {
    count(args: { where: { userId: string; status: { not: MailAccountStatus } } }): Promise<number>;
    findFirst(args: { where: Record<string, unknown>; include?: { settings: boolean } }): Promise<PrismaMailAccountRow | null>;
    findUnique(args: { where: { id: string }; include?: { settings: boolean } }): Promise<PrismaMailAccountRow | null>;
    findMany(args: { where: { userId: string }; orderBy?: Record<string, 'asc' | 'desc'>; include?: { settings: boolean } }): Promise<PrismaMailAccountRow[]>;
    create(args: { data: Record<string, unknown> }): Promise<PrismaMailAccountRow>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<PrismaMailAccountRow>;
  };
  mailOAuthCredential: {
    findUnique(args: { where: { mailAccountId: string } }): Promise<{
      mailAccountId: string;
      encryptedAccessToken: string;
      encryptedRefreshToken: string | null;
      expiresAt: Date | null;
    } | null>;
    upsert(args: {
      where: { mailAccountId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<unknown>;
    deleteMany(args: { where: { mailAccountId: string } }): Promise<{ count: number }>;
  };
  mailAccountSetting: {
    upsert(args: {
      where: { mailAccountId: string };
      create: Record<string, unknown>;
      update: Record<string, unknown>;
    }): Promise<{
      mailAccountId: string;
      syncFrequencyMinutes: number;
      notifyOnSyncError: boolean;
      syncEnabled: boolean;
      createdAt: Date;
      updatedAt: Date;
    }>;
  };
  mailAuditEvent: {
    create(args: {
      data: {
        userId: string;
        mailAccountId?: string | null;
        eventType: string;
        description: string;
        metadata?: string | null;
      };
    }): Promise<unknown>;
    findMany(args: {
      where: { userId: string };
      orderBy: { createdAt: 'desc' };
      take: number;
    }): Promise<MailAuditEventRecord[]>;
  };
  $transaction<T>(fn: (tx: PrismaMailDatabaseClient) => Promise<T>): Promise<T>;
}

export class PrismaMailDatabase implements MailDatabase {
  constructor(private readonly client: PrismaMailDatabaseClient) {}

  async createOAuthState(input: {
    userId: string;
    stateHash: string;
    codeVerifier: string;
    redirectUri: string;
    targetAccountId?: string | null;
    expiresAt: Date;
  }): Promise<void> {
    await this.client.mailOAuthState.create({
      data: {
        userId: input.userId,
        stateHash: input.stateHash,
        codeVerifier: input.codeVerifier,
        redirectUri: input.redirectUri,
        targetAccountId: input.targetAccountId ?? null,
        expiresAt: input.expiresAt,
      },
    });
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
    return this.client.$transaction(async (tx) => {
      const record = await tx.mailOAuthState.findUnique({ where: { stateHash } });
      if (!record) return null;
      await tx.mailOAuthState.delete({ where: { stateHash } }).catch(() => null);
      if (record.expiresAt <= now) return null;
      return {
        userId: record.userId,
        codeVerifier: record.codeVerifier,
        redirectUri: record.redirectUri,
        targetAccountId: record.targetAccountId,
      };
    });
  }

  async countActiveAccounts(userId: string): Promise<number> {
    return this.client.mailAccount.count({
      where: {
        userId,
        status: { not: 'disconnected' },
      },
    });
  }

  async findAccountByGoogleId(userId: string, googleAccountId: string): Promise<MailAccountRecord | null> {
    const row = await this.client.mailAccount.findFirst({
      where: { userId, googleAccountId },
    });
    return row ? toMailAccountRecord(row) : null;
  }

  async findAccountByEmail(userId: string, email: string): Promise<MailAccountRecord | null> {
    const row = await this.client.mailAccount.findFirst({
      where: { userId, email: email.trim().toLowerCase() },
    });
    return row ? toMailAccountRecord(row) : null;
  }

  async findAccountById(userId: string, accountId: string): Promise<MailAccountDetailRecord | null> {
    const row = await this.client.mailAccount.findUnique({
      where: { id: accountId },
      include: { settings: true },
    });
    if (!row || row.userId !== userId) return null;
    return toMailAccountDetailRecord(row);
  }

  async listAccounts(userId: string): Promise<MailAccountRecord[]> {
    const rows = await this.client.mailAccount.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map(toMailAccountRecord);
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
    const scopesStr = input.scopes.join(' ');
    const now = new Date();

    return this.client.$transaction(async (tx) => {
      let existing: PrismaMailAccountRow | null = null;
      if (input.targetAccountId) {
        existing = await tx.mailAccount.findUnique({ where: { id: input.targetAccountId } });
      }
      if (!existing) {
        existing = await tx.mailAccount.findFirst({
          where: {
            userId: input.userId,
            OR: [{ googleAccountId: input.googleAccountId }, { email: normalizedEmail }],
          },
        });
      }

      let accountRow: PrismaMailAccountRow;
      if (existing) {
        accountRow = await tx.mailAccount.update({
          where: { id: existing.id },
          data: {
            googleAccountId: input.googleAccountId,
            email: normalizedEmail,
            displayName: input.displayName ?? existing.displayName,
            avatarUrl: input.avatarUrl ?? existing.avatarUrl,
            status: 'connected',
            scopes: scopesStr,
            lastConnectedAt: now,
            errorMessage: null,
            updatedAt: now,
          },
        });
      } else {
        accountRow = await tx.mailAccount.create({
          data: {
            userId: input.userId,
            googleAccountId: input.googleAccountId,
            email: normalizedEmail,
            displayName: input.displayName ?? null,
            avatarUrl: input.avatarUrl ?? null,
            status: 'connected',
            scopes: scopesStr,
            lastConnectedAt: now,
            errorMessage: null,
            createdAt: now,
            updatedAt: now,
          },
        });
      }

      // Upsert credentials
      await tx.mailOAuthCredential.upsert({
        where: { mailAccountId: accountRow.id },
        create: {
          mailAccountId: accountRow.id,
          encryptedAccessToken: input.encryptedAccessToken,
          encryptedRefreshToken: input.encryptedRefreshToken ?? null,
          tokenType: 'Bearer',
          expiresAt: input.tokenExpiresAt ?? null,
          keyVersion: 1,
          createdAt: now,
          updatedAt: now,
        },
        update: {
          encryptedAccessToken: input.encryptedAccessToken,
          ...(input.encryptedRefreshToken ? { encryptedRefreshToken: input.encryptedRefreshToken } : {}),
          expiresAt: input.tokenExpiresAt ?? null,
          updatedAt: now,
        },
      });

      // Ensure settings exist
      await tx.mailAccountSetting.upsert({
        where: { mailAccountId: accountRow.id },
        create: {
          mailAccountId: accountRow.id,
          syncFrequencyMinutes: 15,
          notifyOnSyncError: true,
          syncEnabled: true,
          createdAt: now,
          updatedAt: now,
        },
        update: {},
      });

      return toMailAccountRecord(accountRow);
    });
  }

  async disconnectAccount(userId: string, accountId: string): Promise<void> {
    await this.client.$transaction(async (tx) => {
      const account = await tx.mailAccount.findUnique({ where: { id: accountId } });
      if (!account || account.userId !== userId) {
        throw new Error('ACCOUNT_NOT_FOUND');
      }

      await tx.mailAccount.update({
        where: { id: accountId },
        data: { status: 'disconnected', updatedAt: new Date() },
      });

      await tx.mailOAuthCredential.deleteMany({
        where: { mailAccountId: accountId },
      });
    });
  }

  async updateAccountStatus(
    accountId: string,
    status: MailAccountStatus,
    errorMessage?: string | null,
    lastSyncAt?: Date | null,
  ): Promise<void> {
    const data: Record<string, unknown> = { status, updatedAt: new Date() };
    if (errorMessage !== undefined) data.errorMessage = errorMessage;
    if (lastSyncAt !== undefined) data.lastSyncAt = lastSyncAt;

    await this.client.mailAccount.update({
      where: { id: accountId },
      data,
    });
  }

  async updateAccountSettings(
    userId: string,
    accountId: string,
    updates: {
      syncFrequencyMinutes?: number | undefined;
      notifyOnSyncError?: boolean | undefined;
      syncEnabled?: boolean | undefined;
    },
  ): Promise<MailAccountSettingsRecord> {
    const account = await this.client.mailAccount.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== userId) {
      throw new Error('ACCOUNT_NOT_FOUND');
    }

    const res = await this.client.mailAccountSetting.upsert({
      where: { mailAccountId: accountId },
      create: {
        mailAccountId: accountId,
        syncFrequencyMinutes: updates.syncFrequencyMinutes ?? 15,
        notifyOnSyncError: updates.notifyOnSyncError ?? true,
        syncEnabled: updates.syncEnabled ?? true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: {
        ...(updates.syncFrequencyMinutes !== undefined ? { syncFrequencyMinutes: updates.syncFrequencyMinutes } : {}),
        ...(updates.notifyOnSyncError !== undefined ? { notifyOnSyncError: updates.notifyOnSyncError } : {}),
        ...(updates.syncEnabled !== undefined ? { syncEnabled: updates.syncEnabled } : {}),
        updatedAt: new Date(),
      },
    });

    return {
      mailAccountId: res.mailAccountId,
      syncFrequencyMinutes: res.syncFrequencyMinutes,
      notifyOnSyncError: res.notifyOnSyncError,
      syncEnabled: res.syncEnabled,
      createdAt: res.createdAt,
      updatedAt: res.updatedAt,
    };
  }

  async getAccountCredentials(
    userId: string,
    accountId: string,
  ): Promise<{
    encryptedAccessToken: string;
    encryptedRefreshToken: string | null;
    tokenExpiresAt: Date | null;
  } | null> {
    const account = await this.client.mailAccount.findUnique({ where: { id: accountId } });
    if (!account || account.userId !== userId) return null;

    const cred = await this.client.mailOAuthCredential.findUnique({
      where: { mailAccountId: accountId },
    });
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
    const data: Record<string, unknown> = {
      encryptedAccessToken,
      updatedAt: new Date(),
    };
    if (encryptedRefreshToken !== undefined) data.encryptedRefreshToken = encryptedRefreshToken;
    if (expiresAt !== undefined) data.expiresAt = expiresAt;

    await this.client.mailOAuthCredential.upsert({
      where: { mailAccountId: accountId },
      create: {
        mailAccountId: accountId,
        encryptedAccessToken,
        encryptedRefreshToken: encryptedRefreshToken ?? null,
        tokenType: 'Bearer',
        expiresAt: expiresAt ?? null,
        keyVersion: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
      update: data,
    });
  }

  async logAuditEvent(input: {
    userId: string;
    mailAccountId?: string | null;
    eventType: string;
    description: string;
    metadata?: string | null;
  }): Promise<void> {
    await this.client.mailAuditEvent.create({
      data: {
        userId: input.userId,
        mailAccountId: input.mailAccountId ?? null,
        eventType: input.eventType,
        description: input.description,
        metadata: input.metadata ?? null,
      },
    });
  }

  async getRecentAuditEvents(userId: string, limit = 10): Promise<MailAuditEventRecord[]> {
    return this.client.mailAuditEvent.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
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
    const accounts = await this.client.mailAccount.findMany({
      where: { userId },
    });

    let totalConnected = 0;
    let accountsNeedingAttention = 0;
    let activeAccounts = 0;
    let disconnectedAccounts = 0;
    let lastSyncAt: Date | null = null;

    for (const acc of accounts) {
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

function toMailAccountRecord(row: PrismaMailAccountRow): MailAccountRecord {
  return {
    id: row.id,
    userId: row.userId,
    googleAccountId: row.googleAccountId,
    email: row.email,
    displayName: row.displayName,
    avatarUrl: row.avatarUrl,
    status: row.status,
    scopes: row.scopes ? row.scopes.split(' ').filter(Boolean) : [],
    lastConnectedAt: row.lastConnectedAt,
    lastSyncAt: row.lastSyncAt,
    errorMessage: row.errorMessage,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function toMailAccountDetailRecord(row: PrismaMailAccountRow): MailAccountDetailRecord {
  const base = toMailAccountRecord(row);
  const settings: MailAccountSettingsRecord = row.settings
    ? {
        mailAccountId: row.settings.mailAccountId,
        syncFrequencyMinutes: row.settings.syncFrequencyMinutes,
        notifyOnSyncError: row.settings.notifyOnSyncError,
        syncEnabled: row.settings.syncEnabled,
        createdAt: row.settings.createdAt,
        updatedAt: row.settings.updatedAt,
      }
    : {
        mailAccountId: row.id,
        syncFrequencyMinutes: 15,
        notifyOnSyncError: true,
        syncEnabled: true,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
      };

  return {
    ...base,
    settings,
  };
}
