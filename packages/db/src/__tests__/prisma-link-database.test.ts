import { describe, expect, it } from 'vitest';
import { PrismaLinkDatabase } from '../prisma-link-database.js';

type Row = {
  id: string;
  userId: string;
  integrationId: string;
  externalSubjectHash: string;
};

function createDatabase() {
  const challenges = new Map<string, { userId: string; integrationId: string; challengeHash: string; expiresAt: Date }>();
  const links = new Map<string, Row>();
  const history: Array<{ userId: string; integrationId: string; unlinkedAt: Date }> = [];
  const audits: Array<{ actorId: string; action: string; targetId: string }> = [];
  let policy = { relinkCooldownHours: 168, requiresReverification: true, adminTransferApprovalRequired: true };
  let storedPolicy: typeof policy | null = null;

  const transaction = {
    linkChallenge: {
      create: async ({ data }: { data: { id: string; userId: string; integrationId: string; challengeHash: string; expiresAt: Date } }) => {
        challenges.set(data.id, data);
        return data;
      },
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = challenges.get(where.id);
        return row ? { id: where.id, ...row } : null;
      },
      deleteMany: async ({ where }: { where: { id?: string; userId?: string; expiresAt?: { gt: Date } } }) => {
        let count = 0;
        for (const [id, row] of challenges) {
          if (where.id !== undefined && id !== where.id) continue;
          if (where.userId !== undefined && row.userId !== where.userId) continue;
          if (where.expiresAt && row.expiresAt <= where.expiresAt.gt) continue;
          challenges.delete(id);
          count += 1;
        }
        return { count };
      },
    },
    accountLink: {
      findUnique: async ({ where }: { where: { id?: string } }) => (where.id ? links.get(where.id) ?? null : null),
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        const row = links.get(where.id);
        if (!row || row.userId !== where.userId) return { count: 0 };
        links.delete(where.id);
        return { count: 1 };
      },
    },
    linkHistory: {
      create: async ({ data }: { data: { userId: string; integrationId: string } }) => {
        history.push({ ...data, unlinkedAt: new Date() });
        return data;
      },
    },
  };

  const database = {
    ...transaction,
    linkChallenge: {
      ...transaction.linkChallenge,
      findUnique: async ({ where }: { where: { id: string } }) => {
        const row = challenges.get(where.id);
        return row ? { id: where.id, ...row } : null;
      },
      // Writes outside a transaction would break atomic replacement; making them
      // throw proves the adapter routes challenge creation through $transaction.
      create: async (): Promise<never> => {
        throw new Error('CHALLENGE_CREATE_OUTSIDE_TRANSACTION');
      },
      deleteMany: transaction.linkChallenge.deleteMany,
    },
    accountLink: {
      ...transaction.accountLink,
      create: async ({ data }: { data: Row }) => {
        const duplicate = [...links.values()].some(
          (row) =>
            (row.userId === data.userId && row.integrationId === data.integrationId) ||
            (row.integrationId === data.integrationId && row.externalSubjectHash === data.externalSubjectHash),
        );
        if (duplicate) throw Object.assign(new Error('unique'), { code: 'P2002' });
        links.set(data.id, data);
        return data;
      },
      findUnique: async ({ where }: { where: { id?: string } }) => (where.id ? links.get(where.id) ?? null : null),
      findFirst: async ({ where }: { where: { userId?: string; integrationId?: string; externalSubjectHash?: string } }) =>
        [...links.values()].find(
          (row) =>
            (where.userId === undefined || row.userId === where.userId) &&
            (where.integrationId === undefined || row.integrationId === where.integrationId) &&
            (where.externalSubjectHash === undefined || row.externalSubjectHash === where.externalSubjectHash),
        ) ?? null,
      findMany: async ({ where }: { where: { userId: string } }) =>
        [...links.values()].filter((row) => row.userId === where.userId),
      deleteMany: transaction.accountLink.deleteMany,
    },
    linkHistory: {
      ...transaction.linkHistory,
      findFirst: async ({ where }: { where: { userId?: string; integrationId?: string } }) => {
        const matches = history.filter(
          (row) =>
            (where.userId === undefined || row.userId === where.userId) &&
            (where.integrationId === undefined || row.integrationId === where.integrationId),
        );
        return matches.at(-1) ?? null;
      },
    },
    linkAudit: {
      create: async ({ data }: { data: { actorId: string; action: string; targetId: string } }) => {
        audits.push(data);
        return data;
      },
    },
    linkPolicySetting: {
      findUnique: async () => storedPolicy,
      upsert: async ({ update }: { update: typeof policy }) => {
        policy = { ...policy, ...update };
        storedPolicy = policy;
        return policy;
      },
    },
    $transaction: async <T>(fn: (tx: typeof transaction) => Promise<T>): Promise<T> => fn(transaction),
    state: { challenges, links, history, audits, get policy() { return policy; } },
  };
  return database;
}

describe('PrismaLinkDatabase', () => {
  it('claims a challenge only for its owner and only while unexpired', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const expiresAt = new Date('2026-11-17T12:15:00.000Z');
    await repository.createChallenge({ id: 'challenge-1', userId: 'user-1', integrationId: 'integration-a', challengeHash: 'hash', expiresAt });

    await expect(repository.consumeChallenge('challenge-1', 'user-2', new Date('2026-11-17T12:00:00.000Z'))).resolves.toBeNull();
    expect(database.state.challenges.size).toBe(1);
    await expect(repository.consumeChallenge('challenge-1', 'user-1', new Date('2026-11-17T12:16:00.000Z'))).resolves.toBeNull();
    await expect(repository.consumeChallenge('challenge-1', 'user-1', new Date('2026-11-17T12:00:00.000Z'))).resolves.toMatchObject({ integrationId: 'integration-a' });
    expect(database.state.challenges.size).toBe(0);
  });

  it('surfaces a concurrent duplicate link as a unique-constraint conflict', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const link = { id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', integrationId: 'integration-a', externalSubjectHash: 'a'.repeat(64) };
    await repository.createLink(link);

    await expect(
      repository.createLink({ ...link, id: '22222222-2222-4222-8222-222222222222' }),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(database.state.links.size).toBe(1);
  });

  it('records unlink history when deleting so the cooldown is enforceable', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const link = { id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', integrationId: 'integration-a', externalSubjectHash: 'a'.repeat(64) };
    await repository.createLink(link);
    await expect(repository.deleteLink(link.id)).resolves.toMatchObject({ id: link.id });

    expect(database.state.history).toHaveLength(1);
    await expect(repository.lastUnlinkedAt('user-1', 'integration-a')).resolves.toBeInstanceOf(Date);
    await expect(repository.lastUnlinkedAt('user-2', 'integration-a')).resolves.toBeNull();
  });

  it('falls back to the default policy until one is stored', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    await expect(repository.getPolicy()).resolves.toEqual({
      relinkCooldownHours: 168,
      requiresReverification: true,
      adminTransferApprovalRequired: true,
    });
    await repository.setPolicy({ relinkCooldownHours: 48, requiresReverification: true, adminTransferApprovalRequired: false });
    await expect(repository.getPolicy()).resolves.toEqual({
      relinkCooldownHours: 48,
      requiresReverification: true,
      adminTransferApprovalRequired: false,
    });
  });
});
