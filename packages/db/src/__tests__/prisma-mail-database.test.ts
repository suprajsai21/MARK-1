import { describe, expect, it } from 'vitest';
import { MemoryMailDatabase } from '../mail-database.js';
import { PrismaMailDatabase } from '../prisma-mail-database.js';
import type { PrismaMailDatabaseClient, PrismaMailAccountRow } from '../prisma-mail-database.js';

describe('Mail Database (In-Memory and Contract Test)', () => {
  it('handles OAuth state storage and single-use consumption with TTL', async () => {
    const db = new MemoryMailDatabase();
    const userId = '11111111-1111-1111-1111-111111111111';
    const expiresAt = new Date(Date.now() + 600_000); // +10 min

    await db.createOAuthState({
      userId,
      stateHash: 'state_hash_1',
      codeVerifier: 'verifier_secret_1',
      redirectUri: 'http://localhost:5173/mail/callback',
      expiresAt,
    });

    // 1st consumption should succeed
    const consumed = await db.consumeOAuthState('state_hash_1', new Date());
    expect(consumed).not.toBeNull();
    expect(consumed?.userId).toBe(userId);
    expect(consumed?.codeVerifier).toBe('verifier_secret_1');
    expect(consumed?.redirectUri).toBe('http://localhost:5173/mail/callback');

    // 2nd consumption should fail (single-use)
    const second = await db.consumeOAuthState('state_hash_1', new Date());
    expect(second).toBeNull();
  });

  it('rejects expired OAuth states', async () => {
    const db = new MemoryMailDatabase();
    const userId = '11111111-1111-1111-1111-111111111111';
    const expiresAt = new Date(Date.now() - 1000); // expired 1s ago

    await db.createOAuthState({
      userId,
      stateHash: 'expired_state',
      codeVerifier: 'verifier_secret_2',
      redirectUri: 'http://localhost:5173/mail/callback',
      expiresAt,
    });

    const consumed = await db.consumeOAuthState('expired_state', new Date());
    expect(consumed).toBeNull();
  });

  it('upserts accounts, maintains settings, and tracks capacity', async () => {
    const db = new MemoryMailDatabase();
    const userId = '11111111-1111-1111-1111-111111111111';

    const account = await db.upsertAccountWithCredentials({
      userId,
      googleAccountId: 'g-12345',
      email: 'work@gmail.com',
      displayName: 'Work Account',
      avatarUrl: 'https://example.com/avatar.jpg',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
      encryptedAccessToken: 'v1:iv:tag:cipher_access',
      encryptedRefreshToken: 'v1:iv:tag:cipher_refresh',
      tokenExpiresAt: new Date(Date.now() + 3600_000),
    });

    expect(account.id).toBeDefined();
    expect(account.email).toBe('work@gmail.com');
    expect(account.status).toBe('connected');

    const accounts = await db.listAccounts(userId);
    expect(accounts.length).toBe(1);
    expect(accounts[0]!.displayName).toBe('Work Account');

    const capacity = await db.countActiveAccounts(userId);
    expect(capacity).toBe(1);

    // Retrieve details + settings
    const details = await db.findAccountById(userId, account.id);
    expect(details).not.toBeNull();
    expect(details!.settings.syncFrequencyMinutes).toBe(15);
    expect(details!.settings.syncEnabled).toBe(true);

    // Update settings
    const updatedSettings = await db.updateAccountSettings(userId, account.id, {
      syncFrequencyMinutes: 30,
      notifyOnSyncError: false,
    });
    expect(updatedSettings.syncFrequencyMinutes).toBe(30);
    expect(updatedSettings.notifyOnSyncError).toBe(false);

    // Verify credentials retrieval (backend only)
    const creds = await db.getAccountCredentials(userId, account.id);
    expect(creds?.encryptedAccessToken).toBe('v1:iv:tag:cipher_access');
    expect(creds?.encryptedRefreshToken).toBe('v1:iv:tag:cipher_refresh');
  });

  it('enforces IDOR protection across different users', async () => {
    const db = new MemoryMailDatabase();
    const userA = '11111111-1111-1111-1111-111111111111';
    const userB = '22222222-2222-2222-2222-222222222222';

    const accountA = await db.upsertAccountWithCredentials({
      userId: userA,
      googleAccountId: 'g-user-a',
      email: 'user.a@gmail.com',
      scopes: ['openid', 'email'],
      encryptedAccessToken: 'v1:iv:tag:token_a',
    });

    // User B attempts to access User A's account
    const accessedByB = await db.findAccountById(userB, accountA.id);
    expect(accessedByB).toBeNull();

    // User B attempts to retrieve User A's credentials
    const credsByB = await db.getAccountCredentials(userB, accountA.id);
    expect(credsByB).toBeNull();

    // User B attempts to disconnect User A's account
    await expect(db.disconnectAccount(userB, accountA.id)).rejects.toThrow();

    // User B attempts to update User A's settings
    await expect(db.updateAccountSettings(userB, accountA.id, { syncFrequencyMinutes: 60 })).rejects.toThrow();
  });

  it('disconnects accounts, removes credentials, and logs audit events', async () => {
    const db = new MemoryMailDatabase();
    const userId = '11111111-1111-1111-1111-111111111111';

    const account = await db.upsertAccountWithCredentials({
      userId,
      googleAccountId: 'g-disconnect-me',
      email: 'disconnect@gmail.com',
      scopes: ['openid', 'email'],
      encryptedAccessToken: 'v1:iv:tag:token',
    });

    await db.logAuditEvent({
      userId,
      mailAccountId: account.id,
      eventType: 'account_connected',
      description: 'Account connected: disconnect@gmail.com',
    });

    // Disconnect
    await db.disconnectAccount(userId, account.id);

    // Status should be disconnected
    const check = await db.findAccountById(userId, account.id);
    expect(check?.status).toBe('disconnected');

    // Credentials should be removed
    const creds = await db.getAccountCredentials(userId, account.id);
    expect(creds).toBeNull();

    await db.logAuditEvent({
      userId,
      mailAccountId: account.id,
      eventType: 'account_disconnected',
      description: 'Account disconnected: disconnect@gmail.com',
    });

    const audits = await db.getRecentAuditEvents(userId, 10);
    expect(audits.length).toBe(2);
    expect(audits[0]!.eventType).toBe('account_disconnected'); // most recent first
  });

  it('computes overview statistics accurately from real records', async () => {
    const db = new MemoryMailDatabase();
    const userId = '11111111-1111-1111-1111-111111111111';

    await db.upsertAccountWithCredentials({
      userId,
      googleAccountId: 'g-acc-1',
      email: 'one@gmail.com',
      scopes: ['openid'],
      encryptedAccessToken: 'v1:a',
    });

    const acc2 = await db.upsertAccountWithCredentials({
      userId,
      googleAccountId: 'g-acc-2',
      email: 'two@gmail.com',
      scopes: ['openid'],
      encryptedAccessToken: 'v1:b',
    });

    // Mark acc2 with an error
    await db.updateAccountStatus(acc2.id, 'error', 'Token refresh revoked');

    const stats = await db.getOverviewStats(userId);
    expect(stats.totalConnected).toBe(2);
    expect(stats.accountsNeedingAttention).toBe(1);
    expect(stats.activeAccounts).toBe(1);
    expect(stats.slotCapacity).toBe(20);
    expect(stats.slotsUsed).toBe(2);
  });

  it('delegates properly via PrismaMailDatabase adapter', async () => {
    const statesMap = new Map<
      string,
      {
        userId: string;
        stateHash: string;
        codeVerifier: string;
        redirectUri: string;
        targetAccountId: string | null;
        expiresAt: Date;
      }
    >();
    const accountsMap = new Map<string, PrismaMailAccountRow>();
    const credsMap = new Map<
      string,
      {
        mailAccountId: string;
        encryptedAccessToken: string;
        encryptedRefreshToken: string | null;
        expiresAt: Date | null;
      }
    >();
    const settingsMap = new Map<
      string,
      {
        mailAccountId: string;
        syncFrequencyMinutes: number;
        notifyOnSyncError: boolean;
        syncEnabled: boolean;
        createdAt: Date;
        updatedAt: Date;
      }
    >();
    const audits: {
      userId: string;
      mailAccountId?: string | null | undefined;
      eventType: string;
      description: string;
      metadata?: string | null | undefined;
      createdAt: Date;
    }[] = [];

    const mockClient: PrismaMailDatabaseClient = {
      mailOAuthState: {
        async create({ data }) {
          statesMap.set(data.stateHash, {
            userId: data.userId,
            stateHash: data.stateHash,
            codeVerifier: data.codeVerifier,
            redirectUri: data.redirectUri,
            targetAccountId: data.targetAccountId ?? null,
            expiresAt: data.expiresAt,
          });
        },
        async findUnique({ where }) {
          return statesMap.get(where.stateHash) ?? null;
        },
        async delete({ where }) {
          statesMap.delete(where.stateHash);
        },
      },
      mailAccount: {
        async count({ where }) {
          let count = 0;
          for (const a of accountsMap.values()) {
            if (a.userId === where.userId && a.status !== 'disconnected') count++;
          }
          return count;
        },
        async findFirst({ where }) {
          for (const a of accountsMap.values()) {
            if (a.userId === where.userId) {
              if (where.googleAccountId && a.googleAccountId === where.googleAccountId) return a;
              if (where.email && a.email === where.email) return a;
            }
          }
          return null;
        },
        async findUnique({ where }) {
          return accountsMap.get(where.id) ?? null;
        },
        async findMany({ where }) {
          return [...accountsMap.values()].filter((a) => a.userId === where.userId);
        },
        async create({ data }) {
          const row: PrismaMailAccountRow = {
            id: 'mock-acc-1',
            userId: String(data.userId),
            googleAccountId: String(data.googleAccountId),
            email: String(data.email),
            displayName: (data.displayName as string | null) ?? null,
            avatarUrl: (data.avatarUrl as string | null) ?? null,
            status: 'connected',
            scopes: String(data.scopes ?? ''),
            lastConnectedAt: new Date(),
            lastSyncAt: null,
            errorMessage: null,
            createdAt: new Date(),
            updatedAt: new Date(),
          };
          accountsMap.set(row.id, row);
          return row;
        },
        async update({ where, data }) {
          const existing = accountsMap.get(where.id)!;
          const updated: PrismaMailAccountRow = {
            ...existing,
            ...(data as Partial<PrismaMailAccountRow>),
            updatedAt: new Date(),
          };
          accountsMap.set(where.id, updated);
          return updated;
        },
      },
      mailOAuthCredential: {
        async findUnique({ where }) {
          return credsMap.get(where.mailAccountId) ?? null;
        },
        async upsert({ where, create, update }) {
          const existing = credsMap.get(where.mailAccountId);
          const val = existing
            ? { ...existing, ...update }
            : {
                mailAccountId: where.mailAccountId,
                encryptedAccessToken: String(create.encryptedAccessToken),
                encryptedRefreshToken: (create.encryptedRefreshToken as string | null) ?? null,
                expiresAt: (create.expiresAt as Date | null) ?? null,
              };
          credsMap.set(where.mailAccountId, val);
          return val;
        },
        async deleteMany({ where }) {
          credsMap.delete(where.mailAccountId);
          return { count: 1 };
        },
      },
      mailAccountSetting: {
        async upsert({ where, create, update }) {
          const existing = settingsMap.get(where.mailAccountId);
          const val = existing
            ? { ...existing, ...update }
            : {
                mailAccountId: where.mailAccountId,
                syncFrequencyMinutes: Number(create.syncFrequencyMinutes ?? 15),
                notifyOnSyncError: Boolean(create.notifyOnSyncError ?? true),
                syncEnabled: Boolean(create.syncEnabled ?? true),
                createdAt: new Date(),
                updatedAt: new Date(),
              };
          settingsMap.set(where.mailAccountId, val);
          return val;
        },
      },
      mailAuditEvent: {
        async create({ data }) {
          audits.push({ ...data, createdAt: new Date() });
        },
        async findMany({ where, take }) {
          return audits
            .filter((a) => a.userId === where.userId)
            .slice(0, take)
            .map((a, i) => ({
              id: `audit-${i}`,
              userId: a.userId,
              mailAccountId: a.mailAccountId ?? null,
              eventType: a.eventType,
              description: a.description,
              metadata: a.metadata ?? null,
              createdAt: a.createdAt,
            }));
        },
      },
      async $transaction(fn) {
        return fn(this);
      },
    };

    const prismaDb = new PrismaMailDatabase(mockClient);
    const userId = '11111111-1111-1111-1111-111111111111';

    // State lifecycle
    await prismaDb.createOAuthState({
      userId,
      stateHash: 'prisma_state_hash',
      codeVerifier: 'verifier_abc',
      redirectUri: 'https://app.mark1.test/callback',
      expiresAt: new Date(Date.now() + 60000),
    });

    const consumed = await prismaDb.consumeOAuthState('prisma_state_hash', new Date());
    expect(consumed?.codeVerifier).toBe('verifier_abc');

    // Account upsert
    const acc = await prismaDb.upsertAccountWithCredentials({
      userId,
      googleAccountId: 'g-999',
      email: 'prisma@mark1.test',
      scopes: ['openid', 'email'],
      encryptedAccessToken: 'v1:prisma_token',
    });
    expect(acc.email).toBe('prisma@mark1.test');

    const count = await prismaDb.countActiveAccounts(userId);
    expect(count).toBe(1);

    await prismaDb.disconnectAccount(userId, acc.id);
    const afterCount = await prismaDb.countActiveAccounts(userId);
    expect(afterCount).toBe(0);
  });
});
