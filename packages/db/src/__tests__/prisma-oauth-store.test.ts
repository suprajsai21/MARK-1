import { describe, expect, it } from 'vitest';
import { PrismaOAuthStore } from '../prisma-oauth-store.js';

const now = new Date('2026-11-17T12:00:00.000Z');

type FamilyRecord = { id: string; userId: string; clientId: string; revokedAt: Date | null };

function createDatabase() {
  const codes = new Map<string, {
    codeHash: string;
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  }>();
  const families = new Map<string, FamilyRecord>();
  const access = new Map<string, { tokenHash: string; familyId: string; expiresAt: Date }>();
  const refresh = new Map<string, { tokenHash: string; familyId: string; expiresAt: Date; consumedAt: Date | null }>();

  const familyOf = (familyId: string): FamilyRecord & { revokedAt: Date | null } => {
    const family = families.get(familyId);
    if (!family) throw new Error('FAMILY_MISSING');
    return family;
  };

  const transaction = {
    oauthAuthorizationCode: {
      findUnique: async ({ where }: { where: { codeHash: string } }) => codes.get(where.codeHash) ?? null,
      deleteMany: async ({ where }: { where: { codeHash: string; expiresAt: { gt: Date } } }) => {
        const row = codes.get(where.codeHash);
        if (!row || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        codes.delete(where.codeHash);
        return { count: 1 };
      },
    },
    oauthTokenFamily: {
      create: async ({ data }: { data: Omit<FamilyRecord, 'revokedAt'> }) => {
        families.set(data.id, { ...data, revokedAt: null });
        return data;
      },
      updateMany: async ({ where, data }: { where: { id: string; revokedAt: null }; data: { revokedAt: Date } }) => {
        const family = families.get(where.id);
        if (!family || family.revokedAt !== null) return { count: 0 };
        family.revokedAt = data.revokedAt;
        return { count: 1 };
      },
    },
    oauthAccessToken: {
      create: async ({ data }: { data: { tokenHash: string; familyId: string; expiresAt: Date } }) => {
        access.set(data.tokenHash, data);
        return data;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = access.get(where.tokenHash);
        return row ? { ...row, family: familyOf(row.familyId) } : null;
      },
    },
    oauthRefreshToken: {
      create: async ({ data }: { data: { tokenHash: string; familyId: string; expiresAt: Date } }) => {
        refresh.set(data.tokenHash, { ...data, consumedAt: null });
        return data;
      },
      findUnique: async ({ where }: { where: { tokenHash: string } }) => {
        const row = refresh.get(where.tokenHash);
        return row ? { ...row, family: familyOf(row.familyId) } : null;
      },
      updateMany: async ({ where, data }: { where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } }; data: { consumedAt: Date } }) => {
        const row = refresh.get(where.tokenHash);
        if (!row || row.consumedAt !== null || row.expiresAt <= where.expiresAt.gt) return { count: 0 };
        row.consumedAt = data.consumedAt;
        return { count: 1 };
      },
    },
  };

  const database = {
    oauthAuthorizationCode: {
      ...transaction.oauthAuthorizationCode,
      create: async ({ data }: { data: Parameters<typeof codes.set>[1] }) => {
        codes.set(data.codeHash, data);
        return data;
      },
    },
    oauthTokenFamily: {
      ...transaction.oauthTokenFamily,
      create: async ({ data }: { data: Omit<FamilyRecord, 'revokedAt'> }) => {
        families.set(data.id, { ...data, revokedAt: null });
        return data;
      },
      findUnique: async ({ where }: { where: { id: string } }) => families.get(where.id) ?? null,
    },
    oauthAccessToken: transaction.oauthAccessToken,
    oauthRefreshToken: transaction.oauthRefreshToken,
    $transaction: async <T>(fn: (tx: typeof transaction) => Promise<T>): Promise<T> => fn(transaction),
    state: { codes, families, access, refresh },
  };
  return database;
}

async function seedFamily(database: ReturnType<typeof createDatabase>, store: PrismaOAuthStore) {
  await database.oauthTokenFamily.create({ data: { id: 'family-1', userId: 'user-1', clientId: 'client-1' } });
  await store.createTokenFamily({
    familyId: 'family-1',
    userId: 'user-1',
    clientId: 'client-1',
    accessTokenHash: 'access-1',
    accessExpiresAt: new Date(now.getTime() + 900_000),
    refreshTokenHash: 'refresh-1',
    refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
  });
}

describe('PrismaOAuthStore', () => {
  it('consumes an authorization code exactly once', async () => {
    const database = createDatabase();
    const store = new PrismaOAuthStore(database as never);
    const record = {
      codeHash: 'code-hash', userId: 'user-1', clientId: 'client-1', redirectUri: 'https://extension.invalid/cb',
      codeChallenge: 'a'.repeat(43), expiresAt: new Date(now.getTime() + 300_000),
    };
    await store.createAuthorizationCode(record);

    await expect(store.consumeAuthorizationCode('code-hash', now)).resolves.toMatchObject({ userId: 'user-1' });
    await expect(store.consumeAuthorizationCode('code-hash', now)).resolves.toBeNull();
  });

  it('does not return an expired authorization code', async () => {
    const database = createDatabase();
    const store = new PrismaOAuthStore(database as never);
    await store.createAuthorizationCode({
      codeHash: 'code-hash', userId: 'user-1', clientId: 'client-1', redirectUri: 'https://extension.invalid/cb',
      codeChallenge: 'a'.repeat(43), expiresAt: new Date(now.getTime() + 300_000),
    });

    await expect(store.consumeAuthorizationCode('code-hash', new Date(now.getTime() + 300_000))).resolves.toBeNull();
  });

  it('rotates a refresh token and records the new pair', async () => {
    const database = createDatabase();
    const store = new PrismaOAuthStore(database as never);
    await seedFamily(database, store);

    await expect(store.rotateRefreshToken({
      refreshTokenHash: 'refresh-1',
      now,
      accessTokenHash: 'access-2',
      accessExpiresAt: new Date(now.getTime() + 900_000),
      nextRefreshTokenHash: 'refresh-2',
      refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    })).resolves.toBe('rotated');

    await expect(store.findAccessToken('access-2')).resolves.toMatchObject({ userId: 'user-1' });
    expect(database.state.refresh.get('refresh-1')?.consumedAt).toEqual(now);
  });

  it('revokes the whole family when a consumed refresh token is replayed', async () => {
    const database = createDatabase();
    const store = new PrismaOAuthStore(database as never);
    await seedFamily(database, store);
    await store.rotateRefreshToken({
      refreshTokenHash: 'refresh-1',
      now,
      accessTokenHash: 'access-2',
      accessExpiresAt: new Date(now.getTime() + 900_000),
      nextRefreshTokenHash: 'refresh-2',
      refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    });

    await expect(store.rotateRefreshToken({
      refreshTokenHash: 'refresh-1',
      now,
      accessTokenHash: 'access-3',
      accessExpiresAt: new Date(now.getTime() + 900_000),
      nextRefreshTokenHash: 'refresh-3',
      refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    })).resolves.toBe('reused');

    expect(database.state.families.get('family-1')?.revokedAt).toEqual(now);
    await expect(store.rotateRefreshToken({
      refreshTokenHash: 'refresh-2',
      now,
      accessTokenHash: 'access-4',
      accessExpiresAt: new Date(now.getTime() + 900_000),
      nextRefreshTokenHash: 'refresh-4',
      refreshExpiresAt: new Date(now.getTime() + 30 * 86_400_000),
    })).resolves.toBe('invalid');
    await expect(store.findAccessToken('access-2')).resolves.toMatchObject({ revokedAt: now });
  });

  it('revokes a family from either an access or a refresh token hash', async () => {
    const database = createDatabase();
    const store = new PrismaOAuthStore(database as never);
    await seedFamily(database, store);

    await expect(store.revokeTokenFamilyByTokenHash('access-1', now)).resolves.toBe(true);
    expect(database.state.families.get('family-1')?.revokedAt).toEqual(now);
    await expect(store.revokeTokenFamilyByTokenHash('unknown', now)).resolves.toBe(false);
  });
});
