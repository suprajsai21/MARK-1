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
  const history: Array<{ userId: string; integrationId: string; externalSubjectHash: string; unlinkedAt: Date }> = [];
  const audits: Array<{ actorId: string; action: string; targetId: string }> = [];
  let policy = { relinkCooldownHours: 168, requiresReverification: true, adminTransferApprovalRequired: true };
  let storedPolicy: typeof policy | null = null;
  let failAudit = false;
  let transactionCalls = 0;

  const transaction = {
    accountLink: {
      // Outside-transaction writes are forbidden in this double so tests prove
      // link mutations use the same Prisma transaction as their audit record.
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
      deleteMany: async ({ where }: { where: { id: string; userId: string } }) => {
        const row = links.get(where.id);
        if (!row || row.userId !== where.userId) return { count: 0 };
        links.delete(where.id);
        return { count: 1 };
      },
    },
    linkAudit: {
      create: async ({ data }: { data: { actorId: string; action: string; targetId: string } }) => {
        if (failAudit) throw new Error('AUDIT_WRITE_FAILED');
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
    linkHistory: {
      create: async ({ data }: { data: { userId: string; integrationId: string; externalSubjectHash: string } }) => {
        history.push({ ...data, unlinkedAt: new Date() });
        return data;
      },
      // Newest-first, matching the adapter's `orderBy: { unlinkedAt: 'desc' }`.
      findFirst: async ({
        where,
      }: {
        where: { userId?: string; integrationId: string; externalSubjectHash?: string };
        orderBy?: { unlinkedAt: 'desc' };
      }) =>
        [...history]
          .reverse()
          .find(
            (row) =>
              (where.userId === undefined || row.userId === where.userId) &&
              row.integrationId === where.integrationId &&
              (where.externalSubjectHash === undefined || row.externalSubjectHash === where.externalSubjectHash),
          ) ?? null,
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
      create: async (): Promise<never> => { throw new Error('ACCOUNT_LINK_CREATE_OUTSIDE_TRANSACTION'); },
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
      create: async (): Promise<never> => { throw new Error('AUDIT_CREATE_OUTSIDE_TRANSACTION'); },
    },
    linkPolicySetting: {
      findUnique: async () => storedPolicy,
      upsert: async (): Promise<never> => { throw new Error('POLICY_UPSERT_OUTSIDE_TRANSACTION'); },
    },
    $transaction: async <T>(fn: (tx: typeof transaction) => Promise<T>): Promise<T> => {
      transactionCalls += 1;
      const priorLinks = new Map(links);
      const priorHistory = [...history];
      const priorPolicy = policy;
      const priorStoredPolicy = storedPolicy;
      const priorAudits = [...audits];
      try {
        return await fn(transaction);
      } catch (error) {
        links.clear();
        for (const [id, row] of priorLinks) links.set(id, row);
        history.splice(0, history.length, ...priorHistory);
        policy = priorPolicy;
        storedPolicy = priorStoredPolicy;
        audits.splice(0, audits.length, ...priorAudits);
        throw error;
      }
    },
    state: {
      challenges, links, history, audits,
      get policy() { return policy; },
      failAudit: (value: boolean) => { failAudit = value; },
      get transactionCalls() { return transactionCalls; },
    },
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
    const audit = { actorId: 'user-1', action: 'link' as const, targetId: link.id };
    await repository.createLink(link, audit, new Date('2026-11-18T12:00:00.000Z'));

    await expect(
      repository.createLink({ ...link, id: '22222222-2222-4222-8222-222222222222' }, { ...audit, targetId: '22222222-2222-4222-8222-222222222222' }, new Date('2026-11-18T12:00:00.000Z')),
    ).rejects.toMatchObject({ code: 'P2002' });
    expect(database.state.links.size).toBe(1);
  });

  it('rolls back link creation when its audit write fails', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const link = { id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', integrationId: 'integration-a', externalSubjectHash: 'a'.repeat(64) };
    database.state.failAudit(true);

    await expect(repository.createLink(link, { actorId: 'user-1', action: 'link', targetId: link.id }, new Date('2026-11-18T12:00:00.000Z')))
      .rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(database.state.links.size).toBe(0);
    expect(database.state.audits).toHaveLength(0);
  });

  it('records subject-scoped unlink history and blocks a cross-account relink during cooldown', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const link = { id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', integrationId: 'integration-a', externalSubjectHash: 'a'.repeat(64) };
    await repository.createLink(link, { actorId: 'user-1', action: 'link', targetId: link.id }, new Date('2026-11-18T12:00:00.000Z'));
    await expect(repository.deleteLink(link.id, new Date(), { actorId: 'user-1', action: 'unlink', targetId: link.id })).resolves.toMatchObject({ id: link.id });

    expect(database.state.history).toHaveLength(1);
    expect(database.state.history[0]!.externalSubjectHash).toBe(link.externalSubjectHash);
    await expect(repository.lastUnlinkedAt('user-1', 'integration-a')).resolves.toBeInstanceOf(Date);
    await expect(repository.lastUnlinkedAt('user-2', 'integration-a')).resolves.toBeNull();
    await expect(repository.lastUnlinkedSubject('integration-a', link.externalSubjectHash))
      .resolves.toMatchObject({ userId: 'user-1' });

    // The same external identity may not move to another customer while the
    // cooldown is running, even though that customer has no history of their own.
    await expect(repository.createLink(
      { ...link, id: '22222222-2222-4222-8222-222222222222', userId: 'user-2' },
      { actorId: 'user-2', action: 'link', targetId: '22222222-2222-4222-8222-222222222222' },
      new Date(),
    )).rejects.toMatchObject({ code: 'RELINK_COOLDOWN' });
    expect(database.state.links.size).toBe(0);
  });

  it('refuses a cross-account transfer until an admin approves it', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const link = { id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', integrationId: 'integration-a', externalSubjectHash: 'a'.repeat(64) };
    const unlinkedAt = new Date('2026-11-17T12:00:00.000Z');
    await repository.createLink(link, { actorId: 'user-1', action: 'link', targetId: link.id }, unlinkedAt);
    await repository.deleteLink(link.id, unlinkedAt, { actorId: 'user-1', action: 'unlink', targetId: link.id });
    await repository.setPolicy(
      { relinkCooldownHours: 1, requiresReverification: true, adminTransferApprovalRequired: true },
      { actorId: 'admin-1', action: 'policy_change', targetId: 'link-policy' },
    );
    const afterCooldown = new Date(database.state.history[0]!.unlinkedAt.getTime() + 2 * 60 * 60 * 1000);

    await expect(repository.createLink(
      { ...link, id: '22222222-2222-4222-8222-222222222222', userId: 'user-2' },
      { actorId: 'user-2', action: 'link', targetId: '22222222-2222-4222-8222-222222222222' },
      afterCooldown,
    )).rejects.toMatchObject({ code: 'TRANSFER_APPROVAL_REQUIRED' });
    expect(database.state.links.size).toBe(0);

    await repository.setPolicy(
      { relinkCooldownHours: 1, requiresReverification: true, adminTransferApprovalRequired: false },
      { actorId: 'admin-1', action: 'policy_change', targetId: 'link-policy' },
    );
    await repository.createLink(
      { ...link, id: '22222222-2222-4222-8222-222222222222', userId: 'user-2' },
      { actorId: 'user-2', action: 'link', targetId: '22222222-2222-4222-8222-222222222222' },
      afterCooldown,
    );
    expect(database.state.links.size).toBe(1);
  });

  it('rolls back unlink and history when its audit write fails', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const link = { id: '11111111-1111-4111-8111-111111111111', userId: 'user-1', integrationId: 'integration-a', externalSubjectHash: 'a'.repeat(64) };
    await repository.createLink(link, { actorId: 'user-1', action: 'link', targetId: link.id }, new Date('2026-11-18T12:00:00.000Z'));
    database.state.failAudit(true);

    await expect(repository.deleteLink(link.id, new Date(), { actorId: 'user-1', action: 'unlink', targetId: link.id }))
      .rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(database.state.links.has(link.id)).toBe(true);
    expect(database.state.history).toHaveLength(0);
    expect(database.state.audits.map((row) => row.action)).toEqual(['link']);
  });

  it('falls back to the default policy until one is stored', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    await expect(repository.getPolicy()).resolves.toEqual({
      relinkCooldownHours: 168,
      requiresReverification: true,
      adminTransferApprovalRequired: true,
    });
    await repository.setPolicy(
      { relinkCooldownHours: 48, requiresReverification: true, adminTransferApprovalRequired: false },
      { actorId: 'admin-1', action: 'policy_change', targetId: 'link-policy' },
    );
    await expect(repository.getPolicy()).resolves.toEqual({
      relinkCooldownHours: 48,
      requiresReverification: true,
      adminTransferApprovalRequired: false,
    });
  });

  it('rolls back a policy change when its audit write fails', async () => {
    const database = createDatabase();
    const repository = new PrismaLinkDatabase(database as never);
    const initialPolicy = await repository.getPolicy();
    database.state.failAudit(true);

    await expect(repository.setPolicy(
      { relinkCooldownHours: 48, requiresReverification: true, adminTransferApprovalRequired: false },
      { actorId: 'admin-1', action: 'policy_change', targetId: 'link-policy' },
    )).rejects.toThrow('AUDIT_WRITE_FAILED');
    await expect(repository.getPolicy()).resolves.toEqual(initialPolicy);
    expect(database.state.audits).toHaveLength(0);
  });
});
