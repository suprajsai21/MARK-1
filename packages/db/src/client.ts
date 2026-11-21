import { PrismaClient } from '@prisma/client';

export interface StoredUser {  id: string;
  email: string;
  passwordHash: string;
  emailVerified: boolean;
  role: 'customer' | 'admin';
}

export interface TokenRecord {
  userId: string;
  expiresAt: Date;
}

export interface AuthRepository {
  createUser(input: { email: string; passwordHash: string }): Promise<StoredUser>;
  findUserByEmail(email: string): Promise<StoredUser | null>;
  findUserById(userId: string): Promise<StoredUser | null>;
  /** Replaces the password hash and revokes every existing session for the user in one transaction. */
  updatePassword(userId: string, passwordHash: string): Promise<void>;
  storeVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeVerificationToken(tokenHash: string, now: Date): Promise<StoredUser | null>;
  storeResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  consumeResetToken(tokenHash: string, now: Date): Promise<string | null>;
  createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void>;
  findSession(tokenHash: string, now: Date): Promise<{ userId: string } | null>;
  deleteSession(tokenHash: string): Promise<void>;
}

export class MemoryAuthRepository implements AuthRepository {
  readonly users = new Map<string, StoredUser>();
  readonly verificationTokens = new Map<string, TokenRecord>();
  readonly resetTokens = new Map<string, TokenRecord>();
  readonly sessions = new Map<string, { userId: string; expiresAt: Date }>();

  async createUser(input: { email: string; passwordHash: string }): Promise<StoredUser> {
    if (this.users.has(input.email)) {
      throw new Error('DUPLICATE_EMAIL');
    }
    const user: StoredUser = {
      id: `user-${this.users.size + 1}`,
      email: input.email,
      passwordHash: input.passwordHash,
      emailVerified: false,
      role: 'customer',
    };
    this.users.set(user.email, user);
    return user;
  }

  async findUserByEmail(email: string): Promise<StoredUser | null> {
    return this.users.get(email) ?? null;
  }

  async findUserById(userId: string): Promise<StoredUser | null> {
    return [...this.users.values()].find((u) => u.id === userId) ?? null;
  }

  async updatePassword(userId: string, passwordHash: string): Promise<void> {
    const user = [...this.users.values()].find((u) => u.id === userId);
    if (user) {
      this.users.set(user.email, { ...user, passwordHash });
    }
    // A password change must not leave previously issued sessions usable.
    for (const [hash, session] of this.sessions) {
      if (session.userId === userId) {
        this.sessions.delete(hash);
      }
    }
  }

  async storeVerificationToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    // Invalidate prior verification tokens for user
    for (const [hash, record] of this.verificationTokens) {
      if (record.userId === userId) {
        this.verificationTokens.delete(hash);
      }
    }
    this.verificationTokens.set(tokenHash, { userId, expiresAt });
  }

  async consumeVerificationToken(tokenHash: string, now: Date): Promise<StoredUser | null> {
    const record = this.verificationTokens.get(tokenHash);
    this.verificationTokens.delete(tokenHash);
    if (!record || record.expiresAt <= now) {
      return null;
    }
    const user = [...this.users.values()].find((u) => u.id === record.userId);
    if (!user) {
      return null;
    }
    const verified = { ...user, emailVerified: true };
    this.users.set(user.email, verified);
    return verified;
  }

  async storeResetToken(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.resetTokens.set(tokenHash, { userId, expiresAt });
  }

  async consumeResetToken(tokenHash: string, now: Date): Promise<string | null> {
    const record = this.resetTokens.get(tokenHash);
    this.resetTokens.delete(tokenHash);
    if (!record || record.expiresAt <= now) {
      return null;
    }
    return record.userId;
  }

  async createSession(userId: string, tokenHash: string, expiresAt: Date): Promise<void> {
    this.sessions.set(tokenHash, { userId, expiresAt });
  }

  async findSession(tokenHash: string, now: Date): Promise<{ userId: string } | null> {
    const session = this.sessions.get(tokenHash);
    if (!session || session.expiresAt <= now) {
      return null;
    }
    return { userId: session.userId };
  }

  async deleteSession(tokenHash: string): Promise<void> {
    this.sessions.delete(tokenHash);
  }
}

export { PrismaAuthRepository, toStoredUser } from './prisma-auth-repository.js';
export type { AuthDatabase, PrismaUserRecord } from './prisma-auth-repository.js';
export { PrismaLinkDatabase } from './prisma-link-database.js';
export type { LinkDatabaseClient as PrismaLinkDatabaseClient } from './prisma-link-database.js';
export { PrismaOAuthStore } from './prisma-oauth-store.js';
export type { OAuthDatabase as PrismaOAuthDatabase, OAuthAuthorizationCodeRecord, OAuthTokenFamilyRecord, OAuthRefreshRotationRecord } from './prisma-oauth-store.js';
export { CryptoError, validateEncryptionKey, encryptToken, decryptToken } from './crypto.js';
export { MemoryMailDatabase } from './mail-database.js';
export type {
  MailAccountDetailRecord,
  MailAccountRecord,
  MailAccountSettingsRecord,
  MailAccountStatus,
  MailAuditEventRecord,
  MailDatabase,
  MailOAuthCredentialRecord,
  MailOAuthStateRecord,
} from './mail-database.js';
export { PrismaMailDatabase } from './prisma-mail-database.js';
export type { PrismaMailDatabaseClient, PrismaMailAccountRow } from './prisma-mail-database.js';
export { PrismaPaymentDatabase } from './prisma-payment-database.js';
export type { PaymentDatabaseClient as PrismaPaymentDatabaseClient } from './prisma-payment-database.js';

/** Creates the durable client from a configured PostgreSQL URL. */
export function createPrismaClient(databaseUrl: string): PrismaClient {
  return new PrismaClient({ datasourceUrl: databaseUrl });
}
