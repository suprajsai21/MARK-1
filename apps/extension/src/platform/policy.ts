import type { PlatformAdapter } from './types.js';

const APPROVED_ACTIONS = new Set(['capture', 'insert']);

/** Integrations stay disabled until their authorization and safe workflow are verified. */
export function isIntegrationReady(adapter: PlatformAdapter): boolean {
  const readiness = adapter.readiness;
  if (!readiness || !readiness.linkMethodVerified || !readiness.stagingAccessVerified) return false;
  if (!readiness.evidenceReference.trim() || !readiness.approvedWorkflowIds.length) return false;
  return readiness.allowedActions.length > 0 && readiness.allowedActions.every((action) => APPROVED_ACTIONS.has(action));
}
