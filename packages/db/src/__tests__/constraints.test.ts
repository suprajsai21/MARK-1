import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const schema = readFileSync(new URL('../../prisma/schema.prisma', import.meta.url), 'utf8');

describe('database auth constraints', () => {
  it('enforces normalized unique user email at the database boundary', () => {
    expect(schema).toMatch(/email\s+String\s+@unique/);
    expect(schema).toMatch(/model User\s*\{[\s\S]*?email\s+String\s+@unique/);
  });

  it('stores only unique token hashes and associates them with users', () => {
    expect(schema).toMatch(/model EmailVerificationToken\s*\{[\s\S]*?tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/model PasswordResetToken\s*\{[\s\S]*?tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/model Session\s*\{[\s\S]*?tokenHash\s+String\s+@unique/);
    expect(schema).toMatch(/@@index\(\[userId\]\)/);
  });
});
