import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');
const migration = readFileSync(
  new URL('../../prisma/migrations/20261118000000_account_links/migration.sql', import.meta.url),
  'utf8',
);

describe('account link persistence', () => {
  it('enforces both one-to-one link constraints at the database boundary', () => {
    expect(schema).toMatch(/model AccountLink\s*\{[\s\S]*?@@unique\(\[userId, integrationId\]\)/);
    expect(schema).toMatch(/model AccountLink\s*\{[\s\S]*?@@unique\(\[integrationId, externalSubjectHash\]\)/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "AccountLink_userId_integrationId_key"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "AccountLink_integrationId_externalSubjectHash_key"/);
  });

  it('stores only hashed challenges and hashed external subjects', () => {
    expect(schema).toMatch(/model LinkChallenge\s*\{[\s\S]*?challengeHash\s+String/);
    expect(schema).not.toMatch(/model LinkChallenge\s*\{[\s\S]*?\bchallenge\s+String/);
    expect(schema).toMatch(/externalSubjectHash\s+String\s+@db\.VarChar\(64\)/);
    expect(schema).not.toMatch(/externalSubject\s+String/);
    expect(migration).toMatch(/"challengeHash" TEXT NOT NULL/);
    expect(migration).toMatch(/"externalSubjectHash" VARCHAR\(64\) NOT NULL/);
  });

  it('retains unlink history so the relink cooldown outlives the deleted link', () => {
    expect(schema).toMatch(/model LinkHistory\s*\{/);
    expect(migration).toMatch(/CREATE TABLE "LinkHistory"/);
    expect(migration).toMatch(/FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  });

  it('creates the link tables and the singleton policy row in the migration', () => {
    for (const table of ['LinkChallenge', 'AccountLink', 'LinkAudit', 'LinkPolicySetting']) {
      expect(migration).toMatch(new RegExp(`CREATE TABLE "${table}"`));
    }
  });
});
