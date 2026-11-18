export type OAuthAuthorizationCodeRecord = {
  codeHash: string;
  userId: string;
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  expiresAt: Date;
};

export type OAuthTokenFamilyRecord = {
  familyId: string;
  userId: string;
  clientId: string;
  accessTokenHash: string;
  accessExpiresAt: Date;
  refreshTokenHash: string;
  refreshExpiresAt: Date;
};

export type OAuthRefreshRotationRecord = {
  refreshTokenHash: string;
  now: Date;
  accessTokenHash: string;
  accessExpiresAt: Date;
  nextRefreshTokenHash: string;
  refreshExpiresAt: Date;
};

type CodeRow = OAuthAuthorizationCodeRecord;
type FamilyRow = { id: string; userId: string; clientId: string; revokedAt: Date | null };
type AccessRow = { familyId: string; expiresAt: Date; family: FamilyRow };
type RefreshRow = {
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  family: FamilyRow;
};

type OAuthAuthorizationCodeDelegate = {
  create(args: { data: CodeRow }): Promise<unknown>;
  findUnique(args: { where: { codeHash: string } }): Promise<CodeRow | null>;
  deleteMany(args: { where: { codeHash: string; expiresAt: { gt: Date } } }): Promise<{ count: number }>;
};
type OAuthTokenFamilyDelegate = {
  create(args: { data: { id: string; userId: string; clientId: string } }): Promise<unknown>;
  findUnique(args: { where: { id: string } }): Promise<FamilyRow | null>;
  updateMany(args: { where: { id: string; revokedAt: null }; data: { revokedAt: Date } }): Promise<{ count: number }>;
};
type OAuthAccessTokenDelegate = {
  create(args: { data: { tokenHash: string; familyId: string; expiresAt: Date } }): Promise<unknown>;
  findUnique(args: { where: { tokenHash: string } }): Promise<AccessRow | null>;
};
type OAuthRefreshTokenDelegate = {
  create(args: { data: { tokenHash: string; familyId: string; expiresAt: Date } }): Promise<unknown>;
  findUnique(args: { where: { tokenHash: string } }): Promise<RefreshRow | null>;
  updateMany(args: {
    where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } };
    data: { consumedAt: Date };
  }): Promise<{ count: number }>;
};

export type OAuthTransaction = {
  oauthAuthorizationCode: Pick<OAuthAuthorizationCodeDelegate, 'findUnique' | 'deleteMany'>;
  oauthTokenFamily: Pick<OAuthTokenFamilyDelegate, 'create' | 'updateMany'>;
  oauthAccessToken: Pick<OAuthAccessTokenDelegate, 'create' | 'findUnique'>;
  oauthRefreshToken: Pick<OAuthRefreshTokenDelegate, 'create' | 'findUnique' | 'updateMany'>;
};

export type OAuthDatabase = OAuthTransaction & {
  oauthAuthorizationCode: OAuthAuthorizationCodeDelegate;
  oauthTokenFamily: OAuthTokenFamilyDelegate;
  oauthAccessToken: OAuthAccessTokenDelegate;
  oauthRefreshToken: OAuthRefreshTokenDelegate;
  $transaction<T>(callback: (transaction: OAuthTransaction) => Promise<T>): Promise<T>;
};

/** Prisma-backed OAuth persistence. Only irreversible credential hashes are stored. */
export class PrismaOAuthStore {
  constructor(private readonly database: OAuthDatabase) {}

  async createAuthorizationCode(record: OAuthAuthorizationCodeRecord): Promise<void> {
    await this.database.oauthAuthorizationCode.create({ data: record });
  }

  async consumeAuthorizationCode(codeHash: string, now: Date): Promise<Omit<CodeRow, 'codeHash'> | null> {
    return this.database.$transaction(async (transaction) => {
      const record = await transaction.oauthAuthorizationCode.findUnique({ where: { codeHash } });
      if (!record || record.expiresAt <= now) return null;
      const claimed = await transaction.oauthAuthorizationCode.deleteMany({ where: { codeHash, expiresAt: { gt: now } } });
      if (claimed.count !== 1) return null;
      return {
        userId: record.userId,
        clientId: record.clientId,
        redirectUri: record.redirectUri,
        codeChallenge: record.codeChallenge,
        expiresAt: record.expiresAt,
      };
    });
  }

  async createTokenFamily(record: OAuthTokenFamilyRecord): Promise<void> {
    await this.database.$transaction(async (transaction) => {
      await transaction.oauthTokenFamily.create({
        data: { id: record.familyId, userId: record.userId, clientId: record.clientId },
      });
      await transaction.oauthAccessToken.create({
        data: { tokenHash: record.accessTokenHash, familyId: record.familyId, expiresAt: record.accessExpiresAt },
      });
      await transaction.oauthRefreshToken.create({
        data: { tokenHash: record.refreshTokenHash, familyId: record.familyId, expiresAt: record.refreshExpiresAt },
      });
    });
  }

  async rotateRefreshToken(record: OAuthRefreshRotationRecord): Promise<'rotated' | 'reused' | 'invalid'> {
    return this.database.$transaction(async (transaction) => {
      const token = await transaction.oauthRefreshToken.findUnique({ where: { tokenHash: record.refreshTokenHash } });
      if (!token) return 'invalid';

      if (token.consumedAt !== null) {
        await transaction.oauthTokenFamily.updateMany({
          where: { id: token.familyId, revokedAt: null }, data: { revokedAt: record.now },
        });
        return 'reused';
      }
      if (token.expiresAt <= record.now || token.family.revokedAt !== null) return 'invalid';

      const claimed = await transaction.oauthRefreshToken.updateMany({
        where: { tokenHash: record.refreshTokenHash, consumedAt: null, expiresAt: { gt: record.now } },
        data: { consumedAt: record.now },
      });
      if (claimed.count !== 1) {
        const current = await transaction.oauthRefreshToken.findUnique({ where: { tokenHash: record.refreshTokenHash } });
        if (current?.consumedAt) {
          await transaction.oauthTokenFamily.updateMany({
            where: { id: current.familyId, revokedAt: null }, data: { revokedAt: record.now },
          });
          return 'reused';
        }
        return 'invalid';
      }

      await transaction.oauthAccessToken.create({
        data: { tokenHash: record.accessTokenHash, familyId: token.familyId, expiresAt: record.accessExpiresAt },
      });
      await transaction.oauthRefreshToken.create({
        data: { tokenHash: record.nextRefreshTokenHash, familyId: token.familyId, expiresAt: record.refreshExpiresAt },
      });
      return 'rotated';
    });
  }

  async findAccessToken(accessTokenHash: string): Promise<{
    familyId: string;
    userId: string;
    clientId: string;
    expiresAt: Date;
    revokedAt: Date | null;
  } | null> {
    const token = await this.database.oauthAccessToken.findUnique({ where: { tokenHash: accessTokenHash } });
    if (!token) return null;
    return {
      familyId: token.familyId,
      userId: token.family.userId,
      clientId: token.family.clientId,
      expiresAt: token.expiresAt,
      revokedAt: token.family.revokedAt,
    };
  }

  async revokeTokenFamilyByTokenHash(tokenHash: string, now: Date): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const access = await transaction.oauthAccessToken.findUnique({ where: { tokenHash } });
      const refresh = access ? null : await transaction.oauthRefreshToken.findUnique({ where: { tokenHash } });
      const familyId = access?.familyId ?? refresh?.familyId;
      if (!familyId) return false;
      const result = await transaction.oauthTokenFamily.updateMany({
        where: { id: familyId, revokedAt: null }, data: { revokedAt: now },
      });
      return result.count === 1;
    });
  }
}
