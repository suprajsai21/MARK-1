import type { LinkDatabase } from '../service.js';

export class MemoryLinkDatabase implements LinkDatabase {
  challenges = new Map<string, { userId: string; integrationId: string; challengeHash: string; expiresAt: Date }>();
  links = new Map<string, { id: string; userId: string; integrationId: string; externalSubjectHash: string }>();
  history = new Map<string, { userId: string; integrationId: string; externalSubjectHash: string; unlinkedAt: Date }>();
  audits: Array<{ actorId: string; action: string; targetId: string }> = [];
  failAudit = false;
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
  async createLink(
    record: { id: string; userId: string; integrationId: string; externalSubjectHash: string },
    audit: { actorId: string; action: string; targetId: string },
    now: Date,
  ) {
    // Synchronous check-and-insert models PostgreSQL's unique constraints and
    // the transactional policy re-check that guards the commit boundary.
    const duplicate = [...this.links.values()].some(
      (link) =>
        (link.userId === record.userId && link.integrationId === record.integrationId) ||
        (link.integrationId === record.integrationId && link.externalSubjectHash === record.externalSubjectHash),
    );
    if (duplicate) {
      throw Object.assign(new Error('LINK_CONFLICT'), { code: 'LINK_CONFLICT' });
    }
    const releaseAt = (unlinkedAt: Date) =>
      unlinkedAt.getTime() + this.policy.relinkCooldownHours * 60 * 60 * 1000;
    const userHistory = this.history.get(`${record.userId}:${record.integrationId}`);
    const subjectHistory = [...this.history.values()].find(
      (row) => row.integrationId === record.integrationId && row.externalSubjectHash === record.externalSubjectHash,
    );
    if ((userHistory && now.getTime() < releaseAt(userHistory.unlinkedAt)) ||
        (subjectHistory && now.getTime() < releaseAt(subjectHistory.unlinkedAt))) {
      throw Object.assign(new Error('RELINK_COOLDOWN'), { code: 'RELINK_COOLDOWN' });
    }
    if (subjectHistory && subjectHistory.userId !== record.userId && this.policy.adminTransferApprovalRequired) {
      throw Object.assign(new Error('TRANSFER_APPROVAL_REQUIRED'), { code: 'TRANSFER_APPROVAL_REQUIRED' });
    }
    this.links.set(record.id, record);
    try {
      if (this.failAudit) throw new Error('AUDIT_WRITE_FAILED');
      this.audits.push(audit);
    } catch (error) {
      this.links.delete(record.id);
      const auditIndex = this.audits.indexOf(audit);
      if (auditIndex !== -1) this.audits.splice(auditIndex, 1);
      throw error;
    }
  }
  async listLinks(userId: string) { return [...this.links.values()].filter((x) => x.userId === userId); }
  async deleteLink(id: string, now: Date, audit: { actorId: string; action: string; targetId: string }) {
    const row = this.links.get(id);
    if (!row) return null;
    this.links.delete(id);
    const historyKey = `${row.userId}:${row.integrationId}`;
    const priorHistory = this.history.get(historyKey);
    this.history.set(historyKey, {
      userId: row.userId,
      integrationId: row.integrationId,
      externalSubjectHash: row.externalSubjectHash,
      unlinkedAt: now,
    });
    try {
      if (this.failAudit) throw new Error('AUDIT_WRITE_FAILED');
      this.audits.push(audit);
    } catch (error) {
      this.links.set(id, row);
      if (priorHistory) {
        this.history.set(historyKey, priorHistory);
      } else {
        this.history.delete(historyKey);
      }
      const auditIndex = this.audits.indexOf(audit);
      if (auditIndex !== -1) this.audits.splice(auditIndex, 1);
      throw error;
    }
    return row;
  }
  async lastUnlinkedAt(userId: string, integrationId: string) {
    return this.history.get(`${userId}:${integrationId}`)?.unlinkedAt ?? null;
  }
  async lastUnlinkedSubject(integrationId: string, externalSubjectHash: string) {
    const matched = [...this.history.values()].find(
      (entry) => entry.integrationId === integrationId && entry.externalSubjectHash === externalSubjectHash,
    );
    return matched ? { userId: matched.userId, unlinkedAt: matched.unlinkedAt } : null;
  }
  async getPolicy() { return this.policy; }
  async setPolicy(policy: typeof this.policy, audit: { actorId: string; action: string; targetId: string }) {
    const priorPolicy = this.policy;
    this.policy = policy;
    try {
      if (this.failAudit) throw new Error('AUDIT_WRITE_FAILED');
      this.audits.push(audit);
    } catch (error) {
      this.policy = priorPolicy;
      const auditIndex = this.audits.indexOf(audit);
      if (auditIndex !== -1) this.audits.splice(auditIndex, 1);
      throw error;
    }
  }
}
