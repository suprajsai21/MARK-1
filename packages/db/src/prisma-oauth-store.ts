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
type AccessRow = { familyId: string; expiresAt: Date; family?: FamilyRow | null };
type RefreshRow = {
  tokenHash: string;
  familyId: string;
  expiresAt: Date;
  consumedAt: Date | null;
  family?: FamilyRow | null;
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
  findUnique(args: { where: { tokenHash: string }; include?: { family: true } }): Promise<AccessRow | null>;
};
type OAuthRefreshTokenDelegate = {
  create(args: { data: { tokenHash: string; familyId: string; expiresAt: Date } }): Promise<unknown>;
  findUnique(args: { where: { tokenHash: string }; include?: { family: true } }): Promise<RefreshRow | null>;
  updateMany(args: {
    where: { tokenHash: string; consumedAt: null; expiresAt: { gt: Date } };
    data: { consumedAt: Date };
  }): Promise<{ count: number }>;
};

export type OAuthTransaction = {
  oauthAuthorizationCode: Pick<OAuthAuthorizationCodeDelegate, 'findUnique' | 'deleteMany'>;
  oauthTokenFamily: Pick<OAuthTokenFamilyDelegate, 'create' | 'findUnique' | 'updateMany'>;
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

// Narrow structural sources support both Prisma's oAuth* names and test doubles' oauth* names.
type OAuthCodeLookupDelegate = Pick<OAuthAuthorizationCodeDelegate, 'findUnique' | 'deleteMany'>;
type OAuthCodeDelegateSource = {
  oAuthAuthorizationCode?: OAuthCodeLookupDelegate;
  oauthAuthorizationCode?: OAuthCodeLookupDelegate;
};
type OAuthFamilyDelegateSource = {
  oAuthTokenFamily?: OAuthTokenFamilyDelegate;
  oauthTokenFamily?: OAuthTokenFamilyDelegate;
};
type OAuthAccessDelegateSource = {
  oAuthAccessToken?: OAuthAccessTokenDelegate;
  oauthAccessToken?: OAuthAccessTokenDelegate;
};
type OAuthRefreshDelegateSource = {
  oAuthRefreshToken?: OAuthRefreshTokenDelegate;
  oauthRefreshToken?: OAuthRefreshTokenDelegate;
};

function getCodeDelegate(db: OAuthCodeDelegateSource): OAuthCodeLookupDelegate {
  const delegate = db.oAuthAuthorizationCode ?? db.oauthAuthorizationCode;
  if (!delegate) {
    throw new Error('OAuth delegate unavailable: oAuthAuthorizationCode or oauthAuthorizationCode');
  }
  return delegate;
}
function getFamilyDelegate(db: OAuthFamilyDelegateSource): OAuthTokenFamilyDelegate {
  const delegate = db.oAuthTokenFamily ?? db.oauthTokenFamily;
  if (!delegate) {
    throw new Error('OAuth delegate unavailable: oAuthTokenFamily or oauthTokenFamily');
  }
  return delegate;
}
function getAccessDelegate(db: OAuthAccessDelegateSource): OAuthAccessTokenDelegate {
  const delegate = db.oAuthAccessToken ?? db.oauthAccessToken;
  if (!delegate) {
    throw new Error('OAuth delegate unavailable: oAuthAccessToken or oauthAccessToken');
  }
  return delegate;
}
function getRefreshDelegate(db: OAuthRefreshDelegateSource): OAuthRefreshTokenDelegate {
  const delegate = db.oAuthRefreshToken ?? db.oauthRefreshToken;
  if (!delegate) {
    throw new Error('OAuth delegate unavailable: oAuthRefreshToken or oauthRefreshToken');
  }
  return delegate;
}
/** Prisma-backed OAuth persistence. Only irreversible credential hashes are stored. */
export class PrismaOAuthStore {
  constructor(private readonly database: OAuthDatabase) {}

  async createAuthorizationCode(record: OAuthAuthorizationCodeRecord): Promise<void> {
    await this.database.oauthAuthorizationCode.create({ data: record });
  }

  async consumeAuthorizationCode(codeHash: string, now: Date): Promise<Omit<CodeRow, 'codeHash'> | null> {
    return this.database.$transaction(async (transaction) => {
      const record = await getCodeDelegate(transaction).findUnique({ where: { codeHash } });
      if (!record || record.expiresAt <= now) return null;
      const claimed = await getCodeDelegate(transaction).deleteMany({ where: { codeHash, expiresAt: { gt: now } } });
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
      await getFamilyDelegate(transaction).create({
        data: { id: record.familyId, userId: record.userId, clientId: record.clientId },
      });
      await getAccessDelegate(transaction).create({
        data: { tokenHash: record.accessTokenHash, familyId: record.familyId, expiresAt: record.accessExpiresAt },
      });
      await getRefreshDelegate(transaction).create({
        data: { tokenHash: record.refreshTokenHash, familyId: record.familyId, expiresAt: record.refreshExpiresAt },
      });
    });
  }

  async rotateRefreshToken(record: OAuthRefreshRotationRecord): Promise<'rotated' | 'reused' | 'invalid'> {
    return this.database.$transaction(async (transaction) => {
      const token = await getRefreshDelegate(transaction).findUnique({
        where: { tokenHash: record.refreshTokenHash },
        include: { family: true },
      });
      if (!token) return 'invalid';

      if (token.consumedAt !== null) {
        await getFamilyDelegate(transaction).updateMany({
          where: { id: token.familyId, revokedAt: null }, data: { revokedAt: record.now },
        });
        return 'reused';
      }
      const family = token.family ?? (await getFamilyDelegate(transaction).findUnique({ where: { id: token.familyId } }));
      if (!family) return 'invalid';
      if (token.expiresAt <= record.now || family.revokedAt !== null) return 'invalid';

      const claimed = await getRefreshDelegate(transaction).updateMany({
        where: { tokenHash: record.refreshTokenHash, consumedAt: null, expiresAt: { gt: record.now } },
        data: { consumedAt: record.now },
      });
      if (claimed.count !== 1) {
        const current = await getRefreshDelegate(transaction).findUnique({ where: { tokenHash: record.refreshTokenHash } });
        if (current?.consumedAt) {
          await getFamilyDelegate(transaction).updateMany({
            where: { id: current.familyId, revokedAt: null }, data: { revokedAt: record.now },
          });
          return 'reused';
        }
        return 'invalid';
      }

      await getAccessDelegate(transaction).create({
        data: { tokenHash: record.accessTokenHash, familyId: token.familyId, expiresAt: record.accessExpiresAt },
      });
      await getRefreshDelegate(transaction).create({
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
    const token = await getAccessDelegate(this.database).findUnique({
      where: { tokenHash: accessTokenHash },
      include: { family: true },
    });
    if (!token) return null;
    const family = token.family ?? (await getFamilyDelegate(this.database).findUnique({ where: { id: token.familyId } }));
    if (!family) return null;
    return {
      familyId: token.familyId,
      userId: family.userId,
      clientId: family.clientId,
      expiresAt: token.expiresAt,
      revokedAt: family.revokedAt,
    };
  }

  async revokeTokenFamilyByTokenHash(tokenHash: string, now: Date): Promise<boolean> {
    return this.database.$transaction(async (transaction) => {
      const access = await getAccessDelegate(transaction).findUnique({ where: { tokenHash } });
      const refresh = access ? null : await getRefreshDelegate(transaction).findUnique({ where: { tokenHash } });
      const familyId = access?.familyId ?? refresh?.familyId;
      if (!familyId) return false;
      const result = await getFamilyDelegate(transaction).updateMany({
        where: { id: familyId, revokedAt: null }, data: { revokedAt: now },
      });
      return result.count === 1;
    });
  }
}
