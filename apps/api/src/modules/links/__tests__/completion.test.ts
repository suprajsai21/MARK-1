import { describe, expect, it } from 'vitest';
import { LinkService } from '../service.js';
import { MemoryLinkDatabase } from './fixtures.js';

const now = new Date('2026-11-17T12:00:00.000Z');
const verified = { id: 'user-1', email: 'customer@example.test', emailVerified: true, role: 'customer' as const };

function makeService(options: { verifier?: { verify: (input: { integrationId: string; challengeId: string; proof: string }) => Promise<{ externalSubject: string } | null> } | null } = {}) {
  const database = new MemoryLinkDatabase();
  const service = new LinkService({
    database,
    verifier: options.verifier === undefined ? null : options.verifier,
    subjectHmacSecret: 'test-subject-secret',
    now: () => now,
  });
  return { database, service };
}

const approvingVerifier = (externalSubject: string) => ({
  verify: async () => ({ externalSubject }),
});

describe('link completion', () => {
  it('fails closed when no approved verifier is configured', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });

    const unconfigured = new LinkService({ database, verifier: null, subjectHmacSecret: 'test-subject-secret', now: () => now });
    await expect(
      unconfigured.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'VERIFIER_UNAVAILABLE' });
    expect(database.links.size).toBe(0);
  });

  it('rejects a completed challenge on replay', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    await service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' });

    await expect(
      service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(database.links.size).toBe(1);
  });

  it('does not consume another customer’s challenge when completion is attempted', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const other = { ...verified, id: 'user-2', email: 'other@example.test' };

    await expect(
      service.complete({ actor: other, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
    expect(database.challenges.has(challenge.challengeId)).toBe(true);
    await expect(
      service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }),
    ).resolves.toMatchObject({ status: 'linked' });
  });

  it('rejects an expired challenge', async () => {
    const database = new MemoryLinkDatabase();
    let clock = now;
    const service = new LinkService({
      database,
      verifier: approvingVerifier('external-1'),
      subjectHmacSecret: 'test-subject-secret',
      now: () => clock,
    });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    clock = new Date(now.getTime() + 15 * 60_000);

    await expect(
      service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'CHALLENGE_INVALID' });
  });

  it('stores an HMAC of the external subject instead of the raw identifier', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-subject-1') });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });

    await service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' });

    const link = [...database.links.values()][0]!;
    expect(link.externalSubjectHash).not.toBe('external-subject-1');
    expect(link.externalSubjectHash).not.toContain('external-subject-1');
    expect(link.externalSubjectHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('fails closed when a verifier is configured but the subject secret is empty', async () => {
    const database = new MemoryLinkDatabase();
    const service = new LinkService({
      database,
      verifier: approvingVerifier('external-1'),
      subjectHmacSecret: '',
      now: () => now,
    });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });

    await expect(
      service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'SUBJECT_SECRET_REQUIRED' });
    expect(database.links.size).toBe(0);
  });

  it('rejects a failed platform verification without activating a link', async () => {
    const { database, service } = makeService({ verifier: { verify: async () => null } });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });

    await expect(
      service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'VERIFICATION_FAILED' });
    expect(database.links.size).toBe(0);
  });

  it('rejects a second account claiming an already-linked platform identity', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    const other = { ...verified, id: 'user-2', email: 'other@example.test' };

    const first = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    await service.complete({ actor: verified, challengeId: first.challengeId, proof: 'proof' });
    const second = await service.createChallenge({ actor: other, integrationId: 'integration-a' });

    await expect(
      service.complete({ actor: other, challengeId: second.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'LINK_CONFLICT' });
    expect(database.links.size).toBe(1);
  });

  it('rolls back link creation when the required audit write fails', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    const challenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    database.failAudit = true;

    await expect(service.complete({ actor: verified, challengeId: challenge.challengeId, proof: 'proof' }))
      .rejects.toThrow('AUDIT_WRITE_FAILED');
    expect(database.links.size).toBe(0);
    expect(database.audits).toHaveLength(0);
  });

  it('rejects completion when an unlink commits while the verifier is waiting', async () => {
    const database = new MemoryLinkDatabase();
    database.policy.relinkCooldownHours = 1;
    let releaseUnlink!: () => void;
    let releaseCompletion!: () => void;
    let unlinkVerifierStarted!: () => void;
    let completionVerifierStarted!: () => void;
    const unlinkGate = new Promise<void>((resolve) => { releaseUnlink = resolve; });
    const completionGate = new Promise<void>((resolve) => { releaseCompletion = resolve; });
    const unlinkStarted = new Promise<void>((resolve) => { unlinkVerifierStarted = resolve; });
    const completionStarted = new Promise<void>((resolve) => { completionVerifierStarted = resolve; });
    const service = new LinkService({
      database,
      subjectHmacSecret: 'test-subject-secret',
      now: () => now,
      verifier: {
        verify: async (input) => {
          if (input.proof === 'unlink') {
            unlinkVerifierStarted();
            await unlinkGate;
          }
          if (input.proof === 'late-completion') {
            completionVerifierStarted();
            await completionGate;
          }
          return { externalSubject: 'external-1' };
        },
      },
    });

    const initial = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const linked = await service.complete({ actor: verified, challengeId: initial.challengeId, proof: 'initial' });

    // Unlink is claimed and its verifier is still pending: no history row exists yet.
    const unlinkChallenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const unlink = service.unlink({ actor: verified, linkId: linked.linkId, challengeId: unlinkChallenge.challengeId, proof: 'unlink' });
    await unlinkStarted;

    // A second challenge is issued and its verification also stalls, then unlink commits.
    const lateChallenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const late = service.complete({ actor: verified, challengeId: lateChallenge.challengeId, proof: 'late-completion' });
    await completionStarted;
    releaseUnlink();
    await unlink;
    releaseCompletion();

    await expect(late).rejects.toMatchObject({ code: 'RELINK_COOLDOWN' });
    expect(database.links.size).toBe(0);
  });

  it('does not let another account claim an identity during its unlink cooldown', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    database.policy.relinkCooldownHours = 1;
    const other = { ...verified, id: 'user-2', email: 'other@example.test' };

    const first = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const linked = await service.complete({ actor: verified, challengeId: first.challengeId, proof: 'proof' });
    const unlinkChallenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    await service.unlink({ actor: verified, linkId: linked.linkId, challengeId: unlinkChallenge.challengeId, proof: 'proof' });

    const second = await service.createChallenge({ actor: other, integrationId: 'integration-a' });
    await expect(
      service.complete({ actor: other, challengeId: second.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'RELINK_COOLDOWN' });
    expect(database.links.size).toBe(0);
  });

  it('requires admin approval for a cross-account transfer after the cooldown', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    let clock = now;
    database.policy.relinkCooldownHours = 1;
    const transferService = new LinkService({
      database,
      verifier: approvingVerifier('external-1'),
      subjectHmacSecret: 'test-subject-secret',
      now: () => clock,
    });
    const other = { ...verified, id: 'user-2', email: 'other@example.test' };

    const first = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const linked = await service.complete({ actor: verified, challengeId: first.challengeId, proof: 'proof' });
    const unlinkChallenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    await service.unlink({ actor: verified, linkId: linked.linkId, challengeId: unlinkChallenge.challengeId, proof: 'proof' });
    clock = new Date(now.getTime() + 60 * 60_000);

    const blocked = await transferService.createChallenge({ actor: other, integrationId: 'integration-a' });
    await expect(
      transferService.complete({ actor: other, challengeId: blocked.challengeId, proof: 'proof' }),
    ).rejects.toMatchObject({ code: 'TRANSFER_APPROVAL_REQUIRED' });

    database.policy.adminTransferApprovalRequired = false;
    const allowed = await transferService.createChallenge({ actor: other, integrationId: 'integration-a' });
    await expect(
      transferService.complete({ actor: other, challengeId: allowed.challengeId, proof: 'proof' }),
    ).resolves.toMatchObject({ status: 'linked' });
    expect(database.links.size).toBe(1);
  });

  it('lets the same account relink after the cooldown expires', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    let clock = now;
    database.policy.relinkCooldownHours = 1;
    const timed = new LinkService({
      database,
      verifier: approvingVerifier('external-1'),
      subjectHmacSecret: 'test-subject-secret',
      now: () => clock,
    });
    const first = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const linked = await service.complete({ actor: verified, challengeId: first.challengeId, proof: 'proof' });
    const unlinkChallenge = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    await service.unlink({ actor: verified, linkId: linked.linkId, challengeId: unlinkChallenge.challengeId, proof: 'proof' });

    clock = new Date(now.getTime() + 60 * 60_000);
    const relink = await timed.createChallenge({ actor: verified, integrationId: 'integration-a' });
    await expect(
      timed.complete({ actor: verified, challengeId: relink.challengeId, proof: 'proof' }),
    ).resolves.toMatchObject({ status: 'linked' });
  });

  it('preserves one-to-one uniqueness when two completions race', async () => {
    const { database, service } = makeService({ verifier: approvingVerifier('external-1') });
    const other = { ...verified, id: 'user-2', email: 'other@example.test' };
    const first = await service.createChallenge({ actor: verified, integrationId: 'integration-a' });
    const second = await service.createChallenge({ actor: other, integrationId: 'integration-a' });

    const results = await Promise.allSettled([
      service.complete({ actor: verified, challengeId: first.challengeId, proof: 'proof' }),
      service.complete({ actor: other, challengeId: second.challengeId, proof: 'proof' }),
    ]);

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(database.links.size).toBe(1);
  });
});
