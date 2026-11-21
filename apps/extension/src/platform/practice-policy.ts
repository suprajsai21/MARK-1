export type WorkflowKind = 'practice' | 'assessment' | 'exam' | 'graded' | 'unknown';

export type PolicyDecision =
  | { allowed: true; reason: null }
  | { allowed: false; reason: 'WORKFLOW_NOT_AUTHORIZED' | 'USER_ACTION_REQUIRED' };

/**
 * Ambiguity resolves to manual-only. Capture and insertion are permitted only
 * when a workflow is explicitly labeled as practice AND the user initiated the
 * action; anything else is blocked.
 */
export function evaluatePracticePolicy(input: {
  workflow: WorkflowKind;
  userInitiated?: boolean;
}): PolicyDecision {
  if (input.workflow !== 'practice') {
    return { allowed: false, reason: 'WORKFLOW_NOT_AUTHORIZED' };
  }
  if (input.userInitiated !== true) {
    return { allowed: false, reason: 'USER_ACTION_REQUIRED' };
  }
  return { allowed: true, reason: null };
}
