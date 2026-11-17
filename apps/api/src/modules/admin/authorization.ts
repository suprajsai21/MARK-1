import type { AuthUser } from '@mark-1/contracts';

export class AdminError extends Error {
  constructor(readonly code: 'UNAUTHENTICATED' | 'ADMIN_REQUIRED') {
    super(code);
    this.name = 'AdminError';
  }
}

/**
 * Administrative actions require an authenticated admin. Roles are assigned
 * out-of-band and audited; no route in this service promotes a customer.
 */
export function authorizeAdmin(actor: AuthUser | null): AuthUser {
  if (!actor) {
    throw new AdminError('UNAUTHENTICATED');
  }
  if (actor.role !== 'admin') {
    throw new AdminError('ADMIN_REQUIRED');
  }
  return actor;
}
