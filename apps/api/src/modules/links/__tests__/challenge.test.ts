import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LinkService } from '../service.js';
import { MemoryLinkDatabase } from './fixtures.js';

const now = new Date('2026-11-17T12:00:00.000Z');
const verified = { id: 'user-1', email: 'customer@example.test', emailVerified: true, role: 'customer' as const };

function makeService(database = new MemoryLinkDatabase(), verifier: { verify: () => Promise<{ externalSubject: string } | null> } | null = { verify: async () => ({ externalSubject: 'external-1' }) }) {
  return {
    database,
    service: new LinkService({
      database,
      verifier,
      subjectHmacSecret: 'test-subject-secret',
      now: () => now,
    }),
  };
}

describe('link challenge', () => {
  it('stores only a hash of a single-use challenge that expires in fifteen minutes', async () => {
    const { database, service } = makeService();

    const created = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });

    expect(created.challenge).toMatch(/^[A-Za-z0-9_-]{40,}$/);
    expect(created.expiresAt).toBe(new Date(now.getTime() + 15 * 60_000).toISOString());

    const stored = database.challenges.get(created.challengeId);
    expect(stored).toBeDefined();
    expect(stored!.challengeHash).not.toContain(created.challenge);
    expect(stored!.challengeHash).toBe(createHash('sha256').update(created.challenge, 'utf8').digest('hex'));
  });

  it('does not issue a challenge when the verifier is disabled', async () => {
    const { database, service } = makeService(new MemoryLinkDatabase(), null);
    await expect(service.createChallenge({ actor: verified, integrationId: 'integration-a' }))
      .rejects.toMatchObject({ code: 'VERIFIER_UNAVAILABLE' });
    expect(database.challenges.size).toBe(0);
  });

  it('refuses to issue a challenge for an unverified customer', async () => {
    const { database, service } = makeService();

    await expect(
      service.createChallenge({
        actor: { ...verified, emailVerified: false },
        integrationId: 'integration-a',
      }),
    ).rejects.toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
    expect(database.challenges.size).toBe(0);
  });
});
