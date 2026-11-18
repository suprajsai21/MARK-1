/**
 * Structural view of the Prisma models used for account linking. Keeping it
 * explicit lets the adapter be unit-tested against an in-memory double while
 * production uses the generated client.
 *
 * The port types are declared here rather than imported from the API package so
 * the persistence layer does not depend on a consumer; they are structurally
 * identical to the API's `LinkDatabase` contract.
 */
export type LinkPolicy = {
  relinkCooldownHours: number;
  requiresReverification: true;
  adminTransferApprovalRequired: boolean;
};

export type StoredLink = {
  id: string;
  userId: string;
  integrationId: string;
  externalSubjectHash: string;
};

export type StoredChallenge = {
  userId: string;
  integrationId: string;
  challengeHash: string;
  expiresAt: Date;
};

export interface PrismaLinkRecord {
  id: string;
  userId: string;
  integrationId: string;
  externalSubjectHash: string;
}

export interface PrismaChallengeRecord {
  id: string;
  userId: string;
  integrationId: string;
  challengeHash: string;
  expiresAt: Date;
}

type ChallengeWhere = { id?: string; userId?: string; integrationId?: string; expiresAt?: { gt: Date } };

export interface LinkTransactionalDatabase {
  linkChallenge: {
    create(input: {
      data: { id: string; userId: string; integrationId: string; challengeHash: string; expiresAt: Date };
    }): Promise<unknown>;
    findUnique(input: { where: { id: string } }): Promise<PrismaChallengeRecord | null>;
    deleteMany(input: { where: ChallengeWhere }): Promise<{ count: number }>;
  };
  accountLink: {
    create(input: { data: PrismaLinkRecord }): Promise<unknown>;
    findUnique(input: { where: { id: string } }): Promise<PrismaLinkRecord | null>;
    deleteMany(input: { where: { id: string; userId: string } }): Promise<{ count: number }>;
  };
  linkHistory: {
    create(input: { data: { userId: string; integrationId: string; externalSubjectHash: string } }): Promise<unknown>;
    findFirst(input: {
      where: { userId?: string; integrationId: string; externalSubjectHash?: string };
      orderBy?: { unlinkedAt: 'desc' };
    }): Promise<{ userId: string; unlinkedAt: Date } | null>;
  };
  linkPolicySetting: {
    findUnique(input: { where: { id: number } }): Promise<LinkPolicy | null>;
    upsert(input: {
      where: { id: number };
      create: LinkPolicy;
      update: LinkPolicy;
    }): Promise<LinkPolicy>;
  };
  linkAudit: {
    create(input: { data: { actorId: string; action: string; targetId: string } }): Promise<unknown>;
  };
}

export interface LinkDatabaseClient extends LinkTransactionalDatabase {
  accountLink: LinkTransactionalDatabase['accountLink'] & {
    findFirst(input: {
      where: { userId?: string; integrationId?: string; externalSubjectHash?: string };
    }): Promise<PrismaLinkRecord | null>;
    findMany(input: { where: { userId: string } }): Promise<PrismaLinkRecord[]>;
  };
  $transaction<T>(callback: (transaction: LinkTransactionalDatabase) => Promise<T>): Promise<T>;
}

const POLICY_ID = 1;

const DEFAULT_POLICY: LinkPolicy = {
  relinkCooldownHours: 168,
  requiresReverification: true,
  adminTransferApprovalRequired: true,
};

/**
 * Durable account-link storage. Duplicate links are rejected by the two unique
 * constraints rather than by a read-then-write check, so concurrent
 * completions cannot both succeed.
 */
export class PrismaLinkDatabase {
  constructor(private readonly database: LinkDatabaseClient) {}

  async createChallenge(record: {
    id: string;
    userId: string;
    integrationId: string;
    challengeHash: string;
    expiresAt: Date;
  }): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      // Only one live challenge per customer and integration; older rows are dropped.
      await transaction.linkChallenge.deleteMany({
        where: { userId: record.userId, integrationId: record.integrationId },
      });
      await transaction.linkChallenge.create({ data: record });
    });
  }

  /**
   * The conditional delete is the claim: it removes the row only when the
   * caller owns it and it has not expired, and the returned count decides the
   * winner. Reading first would let another customer burn the challenge.
   */
  async consumeChallenge(id: string, userId: string, now: Date): Promise<StoredChallenge | null> {
    return this.database.$transaction(async (transaction) => {
      const record = await transaction.linkChallenge.findUnique({ where: { id } });
      const claimed = await transaction.linkChallenge.deleteMany({
        where: { id, userId, expiresAt: { gt: now } },
      });
      if (claimed.count !== 1 || !record || record.userId !== userId) {
        return null;
      }
      return {
        userId: record.userId,
        integrationId: record.integrationId,
        challengeHash: record.challengeHash,
        expiresAt: record.expiresAt,
      };
    });
  }

  async findLinkByUserIntegration(userId: string, integrationId: string): Promise<StoredLink | null> {
    return this.database.accountLink.findFirst({ where: { userId, integrationId } });
  }

  async findLinkByIntegrationSubject(integrationId: string, externalSubjectHash: string): Promise<StoredLink | null> {
    return this.database.accountLink.findFirst({ where: { integrationId, externalSubjectHash } });
  }

  async findLinkById(id: string): Promise<StoredLink | null> {
    return this.database.accountLink.findUnique({ where: { id } });
  }

  async createLink(
    record: StoredLink,
    audit: { actorId: string; action: 'link'; targetId: string },
    now: Date,
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      const policy = (await transaction.linkPolicySetting.findUnique({ where: { id: POLICY_ID } })) ?? DEFAULT_POLICY;
      const userHistory = await transaction.linkHistory.findFirst({
        where: { userId: record.userId, integrationId: record.integrationId },
        orderBy: { unlinkedAt: 'desc' },
      });
      const subjectHistory = await transaction.linkHistory.findFirst({
        where: { integrationId: record.integrationId, externalSubjectHash: record.externalSubjectHash },
        orderBy: { unlinkedAt: 'desc' },
      });
      const releaseAt = (unlinkedAt: Date) => unlinkedAt.getTime() + policy.relinkCooldownHours * 60 * 60 * 1000;
      if ((userHistory && now.getTime() < releaseAt(userHistory.unlinkedAt)) ||
          (subjectHistory && now.getTime() < releaseAt(subjectHistory.unlinkedAt))) {
        throw Object.assign(new Error('RELINK_COOLDOWN'), { code: 'RELINK_COOLDOWN' });
      }
      if (subjectHistory && subjectHistory.userId !== record.userId && policy.adminTransferApprovalRequired) {
        throw Object.assign(new Error('TRANSFER_APPROVAL_REQUIRED'), { code: 'TRANSFER_APPROVAL_REQUIRED' });
      }
      await transaction.accountLink.create({ data: record });
      await transaction.linkAudit.create({ data: audit });
    });
  }

  async listLinks(userId: string): Promise<StoredLink[]> {
    return this.database.accountLink.findMany({ where: { userId } });
  }

  async deleteLink(
    id: string,
    _now: Date,
    audit: { actorId: string; action: 'unlink'; targetId: string },
  ): Promise<StoredLink | null> {
    return this.database.$transaction(async (transaction) => {
      const existing = await transaction.accountLink.findUnique({ where: { id } });
      if (!existing) {
        return null;
      }
      const claimed = await transaction.accountLink.deleteMany({ where: { id, userId: existing.userId } });
      if (claimed.count !== 1) {
        return null;
      }
      await transaction.linkHistory.create({
        data: {
          userId: existing.userId,
          integrationId: existing.integrationId,
          externalSubjectHash: existing.externalSubjectHash,
        },
      });
      await transaction.linkAudit.create({ data: audit });
      return existing;
    });
  }

  async lastUnlinkedAt(userId: string, integrationId: string): Promise<Date | null> {
    const row = await this.database.linkHistory.findFirst({
      where: { userId, integrationId },
      orderBy: { unlinkedAt: 'desc' },
    });
    return row?.unlinkedAt ?? null;
  }

  async lastUnlinkedSubject(
    integrationId: string,
    externalSubjectHash: string,
  ): Promise<{ userId: string; unlinkedAt: Date } | null> {
    return this.database.linkHistory.findFirst({
      where: { integrationId, externalSubjectHash },
      orderBy: { unlinkedAt: 'desc' },
    });
  }

  async getPolicy(): Promise<LinkPolicy> {
    const row = await this.database.linkPolicySetting.findUnique({ where: { id: POLICY_ID } });
    // No row is inserted until an admin changes the policy, so the same defaults
    // that the migration declares are returned when it is absent.
    return row ?? DEFAULT_POLICY;
  }

  async setPolicy(
    policy: LinkPolicy,
    audit: { actorId: string; action: 'policy_change'; targetId: string },
  ): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.linkPolicySetting.upsert({
        where: { id: POLICY_ID },
        create: policy,
        update: policy,
      });
      await transaction.linkAudit.create({ data: audit });
    });
  }
}
