import type { LinkDatabase } from '../service.js';

export class MemoryLinkDatabase implements LinkDatabase {
  challenges = new Map<string, { userId: string; integrationId: string; challengeHash: string; expiresAt: Date }>();
  links = new Map<string, { id: string; userId: string; integrationId: string; externalSubjectHash: string }>();
  history = new Map<string, Date>();
  audits: Array<{ actorId: string; action: string; targetId: string }> = [];
  policy = { relinkCooldownHours: 168, requiresReverification: true as const, adminTransferApprovalRequired: true };

  async createChallenge(record: { id: string; userId: string; integrationId: string; challengeHash: string; expiresAt: Date }) {
    this.challenges.set(record.id, { userId: record.userId, integrationId: record.integrationId, challengeHash: record.challengeHash, expiresAt: record.expiresAt });
  }
  async consumeChallenge(id: string, userId: string, now: Date) {
    const row = this.challenges.get(id);
    if (!row || row.userId !== userId || row.expiresAt <= now) {
      return null;
    }
    this.challenges.delete(id);
    return row;
  }
  async findLinkByUserIntegration(userId: string, integrationId: string) {
    return [...this.links.values()].find((x) => x.userId === userId && x.integrationId === integrationId) ?? null;
  }
  async findLinkByIntegrationSubject(integrationId: string, externalSubjectHash: string) {
    return [...this.links.values()].find((x) => x.integrationId === integrationId && x.externalSubjectHash === externalSubjectHash) ?? null;
  }
  async findLinkById(id: string) { return this.links.get(id) ?? null; }
  async createLink(record: { id: string; userId: string; integrationId: string; externalSubjectHash: string }) {
    // Synchronous check-and-insert models PostgreSQL's unique constraints atomically.
    const duplicate = [...this.links.values()].some(
      (link) =>
        (link.userId === record.userId && link.integrationId === record.integrationId) ||
        (link.integrationId === record.integrationId && link.externalSubjectHash === record.externalSubjectHash),
    );
    if (duplicate) {
      throw Object.assign(new Error('LINK_CONFLICT'), { code: 'LINK_CONFLICT' });
    }
    this.links.set(record.id, record);
  }
  async listLinks(userId: string) { return [...this.links.values()].filter((x) => x.userId === userId); }
  async deleteLink(id: string, now: Date) {
    const row = this.links.get(id);
    if (!row) return null;
    this.links.delete(id);
    this.history.set(`${row.userId}:${row.integrationId}`, now);
    return row;
  }
  async lastUnlinkedAt(userId: string, integrationId: string) { return this.history.get(`${userId}:${integrationId}`) ?? null; }
  async createAudit(record: { actorId: string; action: string; targetId: string }) { this.audits.push(record); }
  async getPolicy() { return this.policy; }
  async setPolicy(policy: typeof this.policy) { this.policy = policy; }
}
