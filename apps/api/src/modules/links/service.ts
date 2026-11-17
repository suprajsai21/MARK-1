import { createHmac, createHash, randomBytes, randomUUID } from 'node:crypto';
import type { AuthUser } from '@mark-1/contracts';

/** Port for an approved external verification mechanism. Disabled until configured. */
export interface PlatformLinkVerifier {
  verify(input: { integrationId: string; challengeId: string; proof: string }): Promise<{ externalSubject: string } | null>;
}

export interface LinkPolicy {
  relinkCooldownHours: number;
  requiresReverification: true;
  adminTransferApprovalRequired: boolean;
}

export type StoredChallenge = {
  userId: string;
  integrationId: string;
  challengeHash: string;
  expiresAt: Date;
};

export type StoredLink = {
  id: string;
  userId: string;
  integrationId: string;
  externalSubjectHash: string;
};

export type AuditRecord = {
  actorId: string;
  action: 'link' | 'unlink' | 'policy_change';
  targetId: string;
};

export interface LinkDatabase {
  createChallenge(record: { id: string; userId: string; integrationId: string; challengeHash: string; expiresAt: Date }): Promise<void>;
  consumeChallenge(id: string, userId: string, now: Date): Promise<StoredChallenge | null>;
  findLinkByUserIntegration(userId: string, integrationId: string): Promise<StoredLink | null>;
  findLinkByIntegrationSubject(integrationId: string, externalSubjectHash: string): Promise<StoredLink | null>;
  findLinkById(id: string): Promise<StoredLink | null>;
  createLink(record: StoredLink): Promise<void>;
  listLinks(userId: string): Promise<StoredLink[]>;
  deleteLink(id: string, now: Date): Promise<StoredLink | null>;
  lastUnlinkedAt(userId: string, integrationId: string): Promise<Date | null>;
  createAudit(record: AuditRecord): Promise<void>;
  getPolicy(): Promise<LinkPolicy>;
  setPolicy(policy: LinkPolicy): Promise<void>;
}

export const DEFAULT_LINK_POLICY: LinkPolicy = {
  relinkCooldownHours: 168,
  requiresReverification: true,
  adminTransferApprovalRequired: true,
};

export const CHALLENGE_TTL_MS = 15 * 60 * 1000;

export class LinkError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'LinkError';
  }
}

/**
 * One-to-one account linking. The service never accepts an external password,
 * cookie, or page content; it only asks a configured verifier to confirm that
 * the customer controls an external identity. With no approved verifier every
 * completion fails closed, so a mock test never implies real authorization.
 */
export class LinkService {
  constructor(
    private readonly options: {
      database: LinkDatabase;
      verifier: PlatformLinkVerifier | null;
      subjectHmacSecret: string;
      now?: () => Date;
    },
  ) {}

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }

  private requireVerified(actor: AuthUser | null): AuthUser {
    if (!actor) {
      throw new LinkError('UNAUTHENTICATED');
    }
    if (!actor.emailVerified) {
      throw new LinkError('EMAIL_NOT_VERIFIED');
    }
    return actor;
  }

  /** HMAC keeps the external identifier usable for uniqueness without storing it. */
  subjectHash(integrationId: string, externalSubject: string): string {
    return createHmac('sha256', this.options.subjectHmacSecret)
      .update(`${integrationId}:${externalSubject}`, 'utf8')
      .digest('hex');
  }

  async createChallenge(input: { actor: AuthUser | null; integrationId: string }): Promise<{
    challengeId: string;
    challenge: string;
    expiresAt: string;
  }> {
    const actor = this.requireVerified(input.actor);
    if (!this.options.verifier) {
      throw new LinkError('VERIFIER_UNAVAILABLE');
    }
    const lastUnlinked = await this.options.database.lastUnlinkedAt(actor.id, input.integrationId);
    const policy = await this.options.database.getPolicy();
    if (lastUnlinked) {
      const releaseAt = lastUnlinked.getTime() + policy.relinkCooldownHours * 60 * 60 * 1000;
      if (this.now().getTime() < releaseAt) {
        throw new LinkError('RELINK_COOLDOWN');
      }
    }

    // The ID is public and only names the row; the unguessable secret is `challenge`.
    const challengeId = randomUUID();
    const challenge = randomToken(32);
    const now = this.now();
    await this.options.database.createChallenge({
      id: challengeId,
      userId: actor.id,
      integrationId: input.integrationId,
      challengeHash: createHash('sha256').update(challenge, 'utf8').digest('hex'),
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
    });
    return {
      challengeId,
      challenge,
      expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS).toISOString(),
    };
  }

  async complete(input: { actor: AuthUser | null; challengeId: string; proof: string }): Promise<{ linkId: string; status: 'linked' }> {
    const actor = this.requireVerified(input.actor);
    if (!this.options.verifier) {
      throw new LinkError('VERIFIER_UNAVAILABLE');
    }
    if (!this.options.subjectHmacSecret.trim()) {
      throw new LinkError('SUBJECT_SECRET_REQUIRED');
    }

    // Ownership is part of the atomic claim so another customer's attempt cannot burn it.
    const challenge = await this.options.database.consumeChallenge(input.challengeId, actor.id, this.now());
    if (!challenge) {
      throw new LinkError('CHALLENGE_INVALID');
    }

    const verified = await this.options.verifier.verify({
      integrationId: challenge.integrationId,
      challengeId: input.challengeId,
      proof: input.proof,
    });
    if (!verified) {
      throw new LinkError('VERIFICATION_FAILED');
    }

    const externalSubjectHash = this.subjectHash(challenge.integrationId, verified.externalSubject);
    if (await this.options.database.findLinkByIntegrationSubject(challenge.integrationId, externalSubjectHash)) {
      throw new LinkError('LINK_CONFLICT');
    }
    if (await this.options.database.findLinkByUserIntegration(actor.id, challenge.integrationId)) {
      throw new LinkError('LINK_CONFLICT');
    }

    const linkId = randomUUID();
    try {
      await this.options.database.createLink({
        id: linkId,
        userId: actor.id,
        integrationId: challenge.integrationId,
        externalSubjectHash,
      });
    } catch (error) {
      // A unique constraint from a concurrent completion means the identity was claimed first.
      if ((error as { code?: string }).code === 'LINK_CONFLICT' || (error as { code?: string }).code === 'P2002') {
        throw new LinkError('LINK_CONFLICT');
      }
      throw error;
    }
    await this.options.database.createAudit({ actorId: actor.id, action: 'link', targetId: linkId });
    return { linkId, status: 'linked' };
  }

  async list(actor: AuthUser | null): Promise<Array<{ linkId: string; integrationId: string }>> {
    const verified = this.requireVerified(actor);
    return (await this.options.database.listLinks(verified.id)).map((link) => ({
      linkId: link.id,
      integrationId: link.integrationId,
    }));
  }

  /**
   * Deleting a link is a destructive action, so it requires an approved
   * verifier to confirm the same external identity again with a fresh
   * one-use challenge. A client-supplied boolean is never sufficient proof.
   */
  async unlink(input: {
    actor: AuthUser | null;
    linkId: string;
    challengeId: string;
    proof: string;
  }): Promise<{ unlinked: true }> {
    const actor = this.requireVerified(input.actor);
    if (!this.options.verifier) {
      throw new LinkError('VERIFIER_UNAVAILABLE');
    }
    if (!this.options.subjectHmacSecret.trim()) {
      throw new LinkError('SUBJECT_SECRET_REQUIRED');
    }
    const existing = await this.options.database.findLinkById(input.linkId);
    if (!existing || existing.userId !== actor.id) {
      throw new LinkError('LINK_NOT_FOUND');
    }

    const challenge = await this.options.database.consumeChallenge(input.challengeId, actor.id, this.now());
    if (!challenge || challenge.integrationId !== existing.integrationId) {
      throw new LinkError('CHALLENGE_INVALID');
    }
    const verified = await this.options.verifier.verify({
      integrationId: existing.integrationId,
      challengeId: input.challengeId,
      proof: input.proof,
    });
    if (!verified) {
      throw new LinkError('VERIFICATION_FAILED');
    }
    if (this.subjectHash(existing.integrationId, verified.externalSubject) !== existing.externalSubjectHash) {
      // A different external identity may not remove someone else's link.
      throw new LinkError('VERIFICATION_FAILED');
    }

    const removed = await this.options.database.deleteLink(input.linkId, this.now());
    if (!removed || removed.userId !== actor.id) {
      throw new LinkError('LINK_NOT_FOUND');
    }
    await this.options.database.createAudit({ actorId: actor.id, action: 'unlink', targetId: input.linkId });
    return { unlinked: true };
  }
}

function randomToken(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}
