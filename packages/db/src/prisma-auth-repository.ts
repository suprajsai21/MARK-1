import type { AuthRepository, StoredUser } from './client.js';

/**
 * Narrow structural view of the Prisma client used by the auth repository.
 * Keeping it explicit means the repository can be unit-tested against an
 * in-memory double while production uses the generated Prisma client.
 */
export interface PrismaUserRecord {
  id: string;
  email: string;
  passwordHash: string;
  emailVerifiedAt: Date | null;
  role: 'customer' | 'admin';
}

export interface TokenRecord {
  id: string;
  userId: string;
  expiresAt: Date;
}

type UniqueWhere = { tokenHash: string };
type ExpiringTokenWhere = { tokenHash?: string; userId?: string; expiresAt?: { gt: Date } };

export interface AuthDatabase {
  user: {
    create(input: { data: { email: string; passwordHash: string } }): Promise<PrismaUserRecord>;
    findUnique(input: {
      where: { email: string } | { id: string };
    }): Promise<PrismaUserRecord | null>;
    update(input: {
      where: { id: string };
      data: { passwordHash?: string; emailVerifiedAt?: Date };
    }): Promise<PrismaUserRecord>;
  };
  emailVerificationToken: {
    create(input: { data: { userId: string; tokenHash: string; expiresAt: Date } }): Promise<unknown>;
    deleteMany(input: { where: ExpiringTokenWhere }): Promise<{ count: number }>;
    findUnique(input: { where: UniqueWhere }): Promise<TokenRecord | null>;
  };
  passwordResetToken: {
    create(input: { data: { userId: string; tokenHash: string; expiresAt: Date } }): Promise<unknown>;
    findUnique(input: { where: UniqueWhere }): Promise<TokenRecord | null>;
    deleteMany(input: { where: ExpiringTokenWhere }): Promise<{ count: number }>;
  };
  session: {
    create(input: { data: { userId: string; tokenHash: string; expiresAt: Date } }): Promise<unknown>;
    findUnique(input: {
      where: { tokenHash: string };
      include?: { user: true };
    }): Promise<(TokenRecord & { user?: PrismaUserRecord }) | null>;
    deleteMany(input: { where: ExpiringTokenWhere }): Promise<{ count: number }>;
  };
  $transaction<T>(callback: (transaction: AuthDatabase) => Promise<T>): Promise<T>;
}

export function toStoredUser(record: PrismaUserRecord): StoredUser {
  return {
    id: record.id,
    email: record.email,
    passwordHash: record.passwordHash,
    emailVerified: record.emailVerifiedAt !== null,
    role: record.role,
  };
}

/** Durable authentication repository backed by PostgreSQL through Prisma. */
export class PrismaAuthRepository implements AuthRepository {
  constructor(private readonly database: AuthDatabase) {}

  async createUser(input: { email: string; passwordHash: string }): Promise<StoredUser> {
    return toStoredUser(
      await this.database.user.create({
        data: { email: input.email, passwordHash: input.passwordHash },
      }),
    );
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    const record = await this.database.user.findUnique({ where: { email } });
    return record ? toStoredUser(record) : null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    const record = await this.database.user.findUnique({ where: { id: userId } });
    return record ? toStoredUser(record) : null;
  }

  /**
   * Changing the password revokes every existing session in the same
   * transaction, so a session stolen before account recovery cannot outlive
   * the reset. If the session delete fails, the password change rolls back.
   */
  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.user.update({ where: { id: userId }, data: { passwordHash } });
      await transaction.session.deleteMany({ where: { userId } });
    });
  }

  async storeVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.emailVerificationToken.deleteMany({ where: { userId } });
      await transaction.emailVerificationToken.create({ data: { userId, tokenHash, expiresAt } });
    });
  }

  /**
   * Consumes a verification token exactly once. The conditional deleteMany is
   * the atomic claim: concurrent callers race on the same row and only the
   * caller whose delete reports a count marks the email verified.
   */
  async consumeVerificationToken(tokenHash: string, now: Date): Promise<StoredUser | null> {
    return this.database.$transaction(async (transaction) => {
      const record = await transaction.emailVerificationToken.findUnique({ where: { tokenHash } });
      const claimed = await transaction.emailVerificationToken.deleteMany({
        where: { tokenHash, expiresAt: { gt: now } },
      });
      if (claimed.count !== 1 || !record) {
        return null;
      }
      const user = await transaction.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: now },
      });
      return toStoredUser(user);
    });
  }

  async storeResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.passwordResetToken.deleteMany({ where: { userId } });
      await transaction.passwordResetToken.create({ data: { userId, tokenHash, expiresAt } });
    });
  }

  async consumeResetToken(tokenHash: string, now: Date): Promise<string | null> {
    return this.database.$transaction(async (transaction) => {
      const record = await transaction.passwordResetToken.findUnique({ where: { tokenHash } });
      const claimed = await transaction.passwordResetToken.deleteMany({
        where: { tokenHash, expiresAt: { gt: now } },
      });
      return claimed.count === 1 && record ? record.userId : null;
    });
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    await this.database.session.create({ data: { userId, tokenHash, expiresAt } });
  }

  async findSession(tokenHash: string, now: Date): Promise<{ userId: string } | null> {
    const session = await this.database.session.findUnique({ where: { tokenHash } });
    if (!session || session.expiresAt <= now) {
      return null;
    }
    return { userId: session.userId };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    await this.database.session.deleteMany({ where: { tokenHash } });
  }
}
