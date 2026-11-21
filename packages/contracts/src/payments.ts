import { z } from 'zod';

export const PriceSnapshotSchema = z.object({
  productVersionId: z.string().trim().min(1).max(64),
  amountPaise: z.number().int().positive().safe(),
  currency: z.literal('INR'),
  version: z.number().int().positive().safe(),
}).strict();
export type PriceSnapshot = z.infer<typeof PriceSnapshotSchema>;

export const EntitlementStatusSchema = z.enum(['active', 'revoked']);
export type EntitlementStatus = z.infer<typeof EntitlementStatusSchema>;

export const PaymentOrderStatusSchema = z.enum(['created', 'paid', 'failed', 'refunded', 'charged_back']);
export type PaymentOrderStatus = z.infer<typeof PaymentOrderStatusSchema>;
