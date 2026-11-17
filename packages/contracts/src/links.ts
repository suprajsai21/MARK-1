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

export const UnlinkLinkInputSchema = z.object({
  challengeId: z.string().uuid(),
  proof: z.string().min(1).max(4096),
}).strict();
export type UnlinkLinkInput = z.infer<typeof UnlinkLinkInputSchema>;

export const LinkPolicySchema = z.object({
  relinkCooldownHours: z.number().int().min(1).max(8_760),
  requiresReverification: z.literal(true),
  adminTransferApprovalRequired: z.boolean(),
}).strict();
export type LinkPolicy = z.infer<typeof LinkPolicySchema>;
