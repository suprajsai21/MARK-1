import { describe, expect, it } from 'vitest';
import { PrismaAuthRepository } from '../prisma-auth-repository.js';

function createDatabase() {
  const users = new Map<string, { id: string; email: string; passwordHash: string; emailVerifiedAt: Date | null; role: 'customer' | 'admin' }>();
  const verificationTokens = new Map<string, { id: string; userId: string; expiresAt: Date }>();
  let deleteCalls = 0;
  const transaction = {
    user: {
      update: async ({ where, data }: { where: { id: string }; data: { emailVerifiedAt: Date } }) => {
        const user = users.get(where.id);
        if (!user) throw new Error('USER_NOT_FOUND');
        const updated = { ...user, emailVerifiedAt: data.emailVerifiedAt };
        users.set(user.id, updated);
        return updated;
      },
    },
    emailVerificationToken: {
      findUnique: async ({ where }: { where: { tokenHash: string } }) => verificationTokens.get(where.tokenHash) ?? null,
      deleteMany: async ({ where }: { where: { tokenHash: string; expiresAt: { gt: Date } } }) => {
        deleteCalls += 1;
        const token = verificationTokens.get(where.tokenHash);
        if (!token || token.expiresAt <= where.expiresAt.gt) return { count: 0 };
        verificationTokens.delete(where.tokenHash);
        return { count: 1 };
      },
    },
  };

  const database = {
    user: {
      create: async ({ data }: { data: { email: string; passwordHash: string } }) => {
        if ([...users.values()].some((user) => user.email.toLowerCase() === data.email.toLowerCase())) {
          throw { code: 'P2002' };
        }
        const user = {
          id: `db-${users.size + 1}`,
          ...data,
          emailVerifiedAt: null,
          role: 'customer' as const,
        };
        users.set(user.id, user);
        return user;
      },
      findUnique: async ({ where }: { where: { email?: string; id?: string } }) =>
        [...users.values()].find((user) => (where.email ? user.email === where.email : user.id === where.id)) ?? null,
    },
    $transaction: async <T>(fn: (tx: typeof transaction) => Promise<T>): Promise<T> => fn(transaction),
    state: { users, verificationTokens },
    get deleteCalls() { return deleteCalls; },
  };
  return database;
}

describe('PrismaAuthRepository', () => {
  it('delegates email uniqueness to the durable database unique constraint', async () => {
    const database = createDatabase();
    const repository = new PrismaAuthRepository(database as never);
    await repository.createUser({ email: 'user@example.com', passwordHash: 'hash' });

    await expect(repository.createUser({ email: 'USER@example.com', passwordHash: 'other-hash' }))
      .rejects.toMatchObject({ code: 'P2002' });
    expect(database.state.users.size).toBe(1);
  });

  it('atomically consumes a verification token only once under concurrent requests', async () => {
    const database = createDatabase();
    const repository = new PrismaAuthRepository(database as never);
    const user = await repository.createUser({ email: 'user@example.com', passwordHash: 'hash' });
    const tokenHash = 'f'.repeat(64);
    const expiresAt = new Date('2026-11-17T12:00:00.000Z');
    database.state.verificationTokens.set(tokenHash, { id: 'token-1', userId: user.id, expiresAt });

    const results = await Promise.all([
      repository.consumeVerificationToken(tokenHash, new Date('2026-11-16T12:00:00.000Z')),
      repository.consumeVerificationToken(tokenHash, new Date('2026-11-16T12:00:00.000Z')),
    ]);

    expect(results.filter(Boolean)).toHaveLength(1);
    expect(results.filter((value) => value === null)).toHaveLength(1);
    expect(database.deleteCalls).toBe(2);
    expect(database.state.users.get(user.id)?.emailVerifiedAt).toBeInstanceOf(Date);
  });
});
