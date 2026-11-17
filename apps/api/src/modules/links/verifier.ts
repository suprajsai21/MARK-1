import type { AuthUser } from '@mark-1/contracts';
import type { PlatformLinkVerifier } from './service.js';

/**
 * The only verifier the runtime can construct by default. It never contacts an
 * external site: until an approved, authorized linking mechanism is configured
 * for a deployment, every verification returns null so linking stays disabled.
 */
export const disabledVerifier: PlatformLinkVerifier = {
  async verify() {
    return null;
  },
};

/** Returns the configured verifier, or the disabled one when none is approved. */
export function approvedVerifier(candidate: PlatformLinkVerifier | null | undefined): PlatformLinkVerifier | null {
  if (!candidate) {
    return null;
  }
  return candidate;
}

export function requireAdmin(actor: AuthUser | null): AuthUser {
  if (!actor) {
    throw Object.assign(new Error('UNAUTHENTICATED'), { code: 'UNAUTHENTICATED' });
  }
  if (actor.role !== 'admin') {
    throw Object.assign(new Error('ADMIN_REQUIRED'), { code: 'ADMIN_REQUIRED' });
  }
  return actor;
}
