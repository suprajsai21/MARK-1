import { createHash } from 'node:crypto';
import { OAuthService } from '../service.js';
import type { OAuthStore } from '../service.js';

export const fixedNow = new Date('2026-11-17T12:00:00.000Z');
export const configuredClient = 'extension-client-test';
export const configuredRedirect = 'https://extension.invalid/oauth/callback';

export function s256(verifier: string): string {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * In-memory store with the same atomicity guarantees as the SQL adapter: the
 * refresh-rotation primitive decides rotated/reused/invalid in one step, so a
 * reused token revokes its whole family.
 */
export class MemoryOAuthStore implements OAuthStore {
  codes = new Map<string, {
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  }>();
  families = new Map<string, {
    userId: string;
    clientId: string;
    revokedAt: Date | null;
    access: Map<string, Date>;
    refresh: Map<string, { expiresAt: Date; consumed: boolean }>;
  }>();

  async createAuthorizationCode(record: {
    codeHash: string;
    userId: string;
    clientId: string;
    redirectUri: string;
    codeChallenge: string;
    expiresAt: Date;
  }): Promise<void> {
    this.codes.set(record.codeHash, {
      userId: record.userId,
      clientId: record.clientId,
      redirectUri: record.redirectUri,
      codeChallenge: record.codeChallenge,
      expiresAt: record.expiresAt,
    });
  }

  async consumeAuthorizationCode(codeHash: string, now: Date) {
    const code = this.codes.get(codeHash);
    if (!code || code.expiresAt <= now) return null;
    this.codes.delete(codeHash);
    return code;
  }

  async createTokenFamily(record: {
    familyId: string;
    userId: string;
    clientId: string;
    accessTokenHash: string;
    accessExpiresAt: Date;
    refreshTokenHash: string;
    refreshExpiresAt: Date;
  }): Promise<void> {
    this.families.set(record.familyId, {
      userId: record.userId,
      clientId: record.clientId,
      revokedAt: null,
      access: new Map([[record.accessTokenHash, record.accessExpiresAt]]),
      refresh: new Map([[record.refreshTokenHash, { expiresAt: record.refreshExpiresAt, consumed: false }]]),
    });
  }

  async rotateRefreshToken(record: {
    refreshTokenHash: string;
    now: Date;
    accessTokenHash: string;
    accessExpiresAt: Date;
    nextRefreshTokenHash: string;
    refreshExpiresAt: Date;
  }): Promise<'rotated' | 'reused' | 'invalid'> {
    for (const family of this.families.values()) {
      const refresh = family.refresh.get(record.refreshTokenHash);
      if (!refresh) continue;
      if (family.revokedAt || refresh.expiresAt <= record.now) return 'invalid';
      if (refresh.consumed) {
        family.revokedAt = record.now;
        return 'reused';
      }
      refresh.consumed = true;
      family.access.set(record.accessTokenHash, record.accessExpiresAt);
      family.refresh.set(record.nextRefreshTokenHash, { expiresAt: record.refreshExpiresAt, consumed: false });
      return 'rotated';
    }
    return 'invalid';
  }

  async findAccessToken(accessTokenHash: string) {
    for (const [familyId, family] of this.families) {
      const expiresAt = family.access.get(accessTokenHash);
      if (expiresAt) {
        return { familyId, userId: family.userId, clientId: family.clientId, expiresAt, revokedAt: family.revokedAt };
      }
    }
    return null;
  }

  async revokeTokenFamilyByTokenHash(tokenHash: string, now: Date): Promise<boolean> {
    for (const family of this.families.values()) {
      if (family.access.has(tokenHash) || family.refresh.has(tokenHash)) {
        family.revokedAt = now;
        return true;
      }
    }
    return false;
  }
}

export function makeOAuthService() {
  const store = new MemoryOAuthStore();
  let now = fixedNow;
  const service = new OAuthService({
    store,
    clientId: configuredClient,
    redirectUris: [configuredRedirect],
    now: () => now,
  });
  return {
    store,
    service,
    setNow(value: Date) {
      now = value;
    },
  };
}

/** Builds a consent POST body for the configured client and redirect. */
export function consentBody(codeChallenge: string) {
  return { clientId: configuredClient, redirectUri: configuredRedirect, codeChallenge, consented: true as const };
}
