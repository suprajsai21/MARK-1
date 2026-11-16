import { z } from 'zod';

export const CreateLinkChallengeInputSchema = z.object({
  integrationId: z.string().trim().min(1).max(64),
}).strict();
export type CreateLinkChallengeInput = z.infer<typeof CreateLinkChallengeInputSchema>;

export const CompleteLinkInputSchema = z.object({
  challengeId: z.string().uuid(),
  proof: z.string().min(1).max(4096),
}).strict();
export type CompleteLinkInput = z.infer<typeof CompleteLinkInputSchema>;
