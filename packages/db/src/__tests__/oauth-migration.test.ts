import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../../prisma/migrations/20261119000000_extension_oauth/migration.sql', import.meta.url), 'utf8');

describe('OAuth persistence schema', () => {
  it('stores authorization codes and bearer token hashes, never raw tokens', () => {
    expect(schema).toMatch(/model OAuthAuthorizationCode\s*\{[\s\S]*?codeHash\s+String\s+@id[\s\S]*?codeChallenge\s+String[\s\S]*?expiresAt\s+DateTime/);
    expect(schema).toMatch(/model OAuthAccessToken\s*\{[\s\S]*?tokenHash\s+String\s+@id[\s\S]*?familyId\s+String[\s\S]*?expiresAt\s+DateTime/);
    expect(schema).toMatch(/model OAuthRefreshToken\s*\{[\s\S]*?tokenHash\s+String\s+@id[\s\S]*?consumedAt\s+DateTime\?/);
    expect(schema).not.toMatch(/model OAuth(?:AuthorizationCode|AccessToken|RefreshToken)[\s\S]*?\b(?:rawToken|accessToken|refreshToken)\s+String/);
    for (const table of ['OAuthAuthorizationCode', 'OAuthTokenFamily', 'OAuthAccessToken', 'OAuthRefreshToken']) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
    expect(migration).toMatch(/CONSTRAINT "OAuthAuthorizationCode_pkey" PRIMARY KEY \("codeHash"\)/);
    expect(migration).toMatch(/CONSTRAINT "OAuthAccessToken_pkey" PRIMARY KEY \("tokenHash"\)/);
    expect(migration).toMatch(/CONSTRAINT "OAuthRefreshToken_pkey" PRIMARY KEY \("tokenHash"\)/);
  });
});
