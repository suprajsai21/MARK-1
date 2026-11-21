import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../prisma/migrations/20261121000000_mail_phase1/migration.sql', import.meta.url),
  'utf8',
);

describe('Mail Phase 1 schema and migration', () => {
  it('defines durable Mail models and relations in schema.prisma', () => {
    expect(schema).toMatch(/enum MailAccountStatus\s*\{[\s\S]*?connected[\s\S]*?disconnected[\s\S]*?needs_reauth[\s\S]*?error/);
    expect(schema).toMatch(/model MailAccount\s*\{[\s\S]*?id\s+String\s+@id\s+@default\(uuid\(\)\)[\s\S]*?userId\s+String[\s\S]*?googleAccountId\s+String[\s\S]*?email\s+String[\s\S]*?status\s+MailAccountStatus/);
    expect(schema).toMatch(/@@unique\(\[userId, email\]\)/);
    expect(schema).toMatch(/@@unique\(\[userId, googleAccountId\]\)/);
    expect(schema).toMatch(/model MailOAuthCredential\s*\{[\s\S]*?encryptedAccessToken\s+String[\s\S]*?encryptedRefreshToken\s+String\?/);
    expect(schema).toMatch(/model MailAccountSetting\s*\{[\s\S]*?syncFrequencyMinutes\s+Int[\s\S]*?syncEnabled\s+Boolean/);
    expect(schema).toMatch(/model MailAuditEvent\s*\{[\s\S]*?eventType\s+String[\s\S]*?description\s+String/);
    expect(schema).toMatch(/model MailOAuthState\s*\{[\s\S]*?stateHash\s+String\s+@unique[\s\S]*?codeVerifier\s+String/);

    // Verify plaintext tokens are never present on MailAccount
    expect(schema).not.toMatch(/model MailAccount\s*\{[\s\S]*?\b(?:accessToken|refreshToken|token)\s+String/);
  });

  it('creates tables, indexes, and cascade constraints in migration.sql', () => {
    for (const table of ['MailAccount', 'MailOAuthCredential', 'MailAccountSetting', 'MailAuditEvent', 'MailOAuthState']) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
    expect(migration).toMatch(/CREATE TYPE "MailAccountStatus"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "MailAccount_userId_email_key"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "MailAccount_userId_googleAccountId_key"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "MailOAuthState_stateHash_key"/);
    expect(migration).toMatch(/REFERENCES "User"\("id"\) ON DELETE CASCADE/);
    expect(migration).toMatch(/REFERENCES "MailAccount"\("id"\) ON DELETE CASCADE/);
  });
});
