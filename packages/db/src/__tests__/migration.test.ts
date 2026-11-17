import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  new URL('../../prisma/migrations/20261117000000_auth_foundation/migration.sql', import.meta.url),
  'utf8',
);

describe('auth persistence migration', () => {
  it('creates durable user, verification token, reset token, and session tables with constraints', () => {
    expect(migration).toMatch(/CREATE TABLE "User"/);
    expect(migration).toMatch(/CREATE UNIQUE INDEX "User_email_key"/);
    expect(migration).toMatch(/CREATE TABLE "EmailVerificationToken"/);
    expect(migration).toMatch(/CREATE TABLE "PasswordResetToken"/);
    expect(migration).toMatch(/CREATE TABLE "Session"/);
    expect(migration).toMatch(/FOREIGN KEY \("userId"\) REFERENCES "User"\("id"\) ON DELETE CASCADE/);
  });
});
