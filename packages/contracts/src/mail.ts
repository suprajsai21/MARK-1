import { z } from 'zod';

export const MailAccountStatusSchema = z.enum([
  'connected',
  'disconnected',
  'needs_reauth',
  'error',
]);
export type MailAccountStatus = z.infer<typeof MailAccountStatusSchema>;

export const MailAccountSummarySchema = z.object({
  id: z.string().uuid(),
  email: z.string().trim().toLowerCase().max(254).email(),
  displayName: z.string().nullable(),
  avatarUrl: z.string().url().nullable(),
  status: MailAccountStatusSchema,
  scopes: z.array(z.string()),
  lastConnectedAt: z.string().datetime().nullable(),
  lastSyncAt: z.string().datetime().nullable(),
  errorMessage: z.string().nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
}).strict();
export type MailAccountSummary = z.infer<typeof MailAccountSummarySchema>;

export const MailAccountSettingsSchema = z.object({
  syncFrequencyMinutes: z.number().int().min(5).max(1440).default(15),
  notifyOnSyncError: z.boolean().default(true),
  syncEnabled: z.boolean().default(true),
}).strict();
export type MailAccountSettings = z.infer<typeof MailAccountSettingsSchema>;

export const UpdateMailAccountSettingsInputSchema = z.object({
  syncFrequencyMinutes: z.number().int().min(5).max(1440).optional(),
  notifyOnSyncError: z.boolean().optional(),
  syncEnabled: z.boolean().optional(),
}).strict();
export type UpdateMailAccountSettingsInput = z.infer<typeof UpdateMailAccountSettingsInputSchema>;

export const MailAccountDetailSchema = MailAccountSummarySchema.extend({
  settings: MailAccountSettingsSchema,
}).strict();
export type MailAccountDetail = z.infer<typeof MailAccountDetailSchema>;

export const MailAuditEventSchema = z.object({
  id: z.string().uuid(),
  eventType: z.string().min(1).max(64),
  description: z.string().min(1).max(512),
  createdAt: z.string().datetime(),
  mailAccountId: z.string().uuid().nullable(),
}).strict();
export type MailAuditEvent = z.infer<typeof MailAuditEventSchema>;

export const MailOverviewSchema = z.object({
  totalConnected: z.number().int().min(0),
  accountsNeedingAttention: z.number().int().min(0),
  activeAccounts: z.number().int().min(0),
  disconnectedAccounts: z.number().int().min(0),
  slotCapacity: z.number().int().default(20),
  slotsUsed: z.number().int().min(0),
  lastSyncAt: z.string().datetime().nullable(),
  modulesAvailability: z.object({
    mail: z.literal(true),
    inbox: z.literal('phase2_preview'),
    compose: z.literal('phase3_preview'),
    queue: z.literal('phase4_preview'),
    templates: z.literal('phase1_ready'),
    drafts: z.literal('phase1_ready'),
  }).strict(),
  recentActivity: z.array(MailAuditEventSchema),
}).strict();
export type MailOverview = z.infer<typeof MailOverviewSchema>;

export const InitiateMailOAuthInputSchema = z.object({
  redirectUrl: z.string().url().max(2048).optional(),
}).strict();
export type InitiateMailOAuthInput = z.infer<typeof InitiateMailOAuthInputSchema>;

export const InitiateMailOAuthResponseSchema = z.object({
  authorizationUrl: z.string().url(),
  state: z.string().min(1).max(512),
}).strict();
export type InitiateMailOAuthResponse = z.infer<typeof InitiateMailOAuthResponseSchema>;

export const CompleteMailOAuthInputSchema = z.object({
  code: z.string().min(1).max(4096),
  state: z.string().min(1).max(512),
}).strict();
export type CompleteMailOAuthInput = z.infer<typeof CompleteMailOAuthInputSchema>;

export const ReconnectMailAccountInputSchema = z.object({
  redirectUrl: z.string().url().max(2048).optional(),
}).strict();
export type ReconnectMailAccountInput = z.infer<typeof ReconnectMailAccountInputSchema>;

export const DisconnectMailAccountInputSchema = z.object({
  confirmEmail: z.string().email().optional(),
}).strict();
export type DisconnectMailAccountInput = z.infer<typeof DisconnectMailAccountInputSchema>;

export const MailHealthCheckResponseSchema = z.object({
  accountId: z.string().uuid(),
  status: MailAccountStatusSchema,
  healthy: z.boolean(),
  message: z.string(),
  checkedAt: z.string().datetime(),
  lastSyncAt: z.string().datetime().nullable(),
}).strict();
export type MailHealthCheckResponse = z.infer<typeof MailHealthCheckResponseSchema>;

export const MailSettingsSchema = z.object({
  slotCapacity: z.number().int().default(20),
  slotsUsed: z.number().int().min(0),
  defaultSyncFrequencyMinutes: z.number().int().default(15),
  encryptionStatus: z.literal('AES-256-GCM authenticated encryption active'),
  gmailScopeLevel: z.literal('read_only'),
}).strict();
export type MailSettings = z.infer<typeof MailSettingsSchema>;
