import { describe, expect, it } from 'vitest';
import { CompleteLinkInputSchema, CreateLinkChallengeInputSchema } from '../links';

describe('CreateLinkChallengeInput', () => {
  it('trims a non-empty opaque integration identifier', () => {
    expect(CreateLinkChallengeInputSchema.parse({ integrationId: '  generic-integration  ' })).toEqual({
      integrationId: 'generic-integration',
    });
  });

  it('rejects empty, oversized, and unknown fields', () => {
    expect(CreateLinkChallengeInputSchema.safeParse({ integrationId: '  ' }).success).toBe(false);
    expect(CreateLinkChallengeInputSchema.safeParse({ integrationId: 'x'.repeat(65) }).success).toBe(false);
    expect(CreateLinkChallengeInputSchema.safeParse({ integrationId: 'generic-integration', extra: true }).success).toBe(false);
  });
});

describe('CompleteLinkInput', () => {
  it('accepts a UUID challenge and non-empty proof', () => {
    expect(CompleteLinkInputSchema.parse({
      challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: 'signed-proof',
    })).toEqual({ challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: 'signed-proof' });
  });

  it('rejects malformed challenge IDs, empty or oversized proof, and unknown fields', () => {
    expect(CompleteLinkInputSchema.safeParse({ challengeId: 'not-a-uuid', proof: 'signed-proof' }).success).toBe(false);
    expect(CompleteLinkInputSchema.safeParse({ challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: '' }).success).toBe(false);
    expect(CompleteLinkInputSchema.safeParse({ challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: 'x'.repeat(4097) }).success).toBe(false);
    expect(CompleteLinkInputSchema.safeParse({ challengeId: '123e4567-e89b-42d3-a456-426614174000', proof: 'signed-proof', extra: true }).success).toBe(false);
  });
});
