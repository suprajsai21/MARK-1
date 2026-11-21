import { describe, expect, it } from 'vitest';
import { evaluatePracticePolicy } from '../practice-policy.js';

describe('practice-only policy', () => {
  it('blocks capture and insertion by default', () => {
    expect(evaluatePracticePolicy({ workflow: 'unknown' })).toEqual({
      allowed: false,
      reason: 'WORKFLOW_NOT_AUTHORIZED',
    });
  });

  it('allows an explicitly authorized practice workflow', () => {
    expect(evaluatePracticePolicy({ workflow: 'practice', userInitiated: true })).toEqual({
      allowed: true,
      reason: null,
    });
  });

  it('blocks practice use that the user did not initiate', () => {
    expect(evaluatePracticePolicy({ workflow: 'practice', userInitiated: false })).toEqual({
      allowed: false,
      reason: 'USER_ACTION_REQUIRED',
    });
  });

  it('blocks assessment, exam, and unlabeled workflows', () => {
    for (const workflow of ['assessment', 'exam', 'graded'] as const) {
      expect(evaluatePracticePolicy({ workflow, userInitiated: true }).allowed).toBe(false);
    }
  });
});
