import { describe, expect, it } from 'vitest';
import {
  CompleteMailOAuthInputSchema,
  InitiateMailOAuthResponseSchema,
  MailAccountDetailSchema,
  MailAccountSettingsSchema,
  MailAccountStatusSchema,
  MailAccountSummarySchema,
  MailHealthCheckResponseSchema,
  MailOverviewSchema,
  UpdateMailAccountSettingsInputSchema,
} from '../mail.js';

describe('Mail contracts', () => {
  it('validates MailAccountStatus correctly', () => {
    expect(MailAccountStatusSchema.parse('connected')).toBe('connected');
    expect(MailAccountStatusSchema.parse('disconnected')).toBe('disconnected');
    expect(MailAccountStatusSchema.parse('needs_reauth')).toBe('needs_reauth');
    expect(MailAccountStatusSchema.parse('error')).toBe('error');
    expect(() => MailAccountStatusSchema.parse('invalid_status')).toThrow();
  });

  it('validates MailAccountSummary and enforces no token leakage in contract', () => {
    const summary = {
      id: '550e8400-e29b-41d4-a716-446655440000',
      email: 'user@example.com',
      displayName: 'Work Mail',
      avatarUrl: 'https://example.com/avatar.jpg',
      status: 'connected',
      scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
      lastConnectedAt: '2026-11-20T10:00:00.000Z',
      lastSyncAt: '2026-11-20T12:00:00.000Z',
      errorMessage: null,
      createdAt: '2026-11-19T00:00:00.000Z',
      updatedAt: '2026-11-20T12:00:00.000Z',
    };

    const parsed = MailAccountSummarySchema.parse(summary);
    expect(parsed.email).toBe('user@example.com');
    expect(parsed.status).toBe('connected');

    const detail = MailAccountDetailSchema.parse({
      ...summary,
      settings: {
        syncFrequencyMinutes: 15,
        notifyOnSyncError: true,
        syncEnabled: true,
      },
    });
    expect(detail.settings.syncFrequencyMinutes).toBe(15);

    // Ensure contract strictly prevents secret tokens from being accepted/emitted
    expect(() =>
      MailAccountSummarySchema.parse({
        ...summary,
        accessToken: 'leak',
      }),
    ).toThrow();
  });

  it('validates MailAccountSettings with valid ranges', () => {
    const valid = MailAccountSettingsSchema.parse({
      syncFrequencyMinutes: 30,
      notifyOnSyncError: true,
      syncEnabled: true,
    });
    expect(valid.syncFrequencyMinutes).toBe(30);

    expect(() =>
      MailAccountSettingsSchema.parse({
        syncFrequencyMinutes: 1, // too low, min 5
        notifyOnSyncError: true,
        syncEnabled: true,
      }),
    ).toThrow();

    expect(() =>
      MailAccountSettingsSchema.parse({
        syncFrequencyMinutes: 2000, // too high, max 1440
        notifyOnSyncError: true,
        syncEnabled: true,
      }),
    ).toThrow();
  });

  it('validates UpdateMailAccountSettings partial inputs', () => {
    const partial = UpdateMailAccountSettingsInputSchema.parse({
      syncFrequencyMinutes: 60,
    });
    expect(partial.syncFrequencyMinutes).toBe(60);
    expect(partial.syncEnabled).toBeUndefined();
  });

  it('validates MailOverview structure with slot capacity and availability', () => {
    const overview = MailOverviewSchema.parse({
      totalConnected: 3,
      accountsNeedingAttention: 1,
      activeAccounts: 2,
      disconnectedAccounts: 0,
      slotCapacity: 20,
      slotsUsed: 3,
      lastSyncAt: '2026-11-20T12:00:00.000Z',
      modulesAvailability: {
        mail: true,
        inbox: 'phase2_preview',
        compose: 'phase3_preview',
        queue: 'phase4_preview',
        templates: 'phase1_ready',
        drafts: 'phase1_ready',
      },
      recentActivity: [
        {
          id: '550e8400-e29b-41d4-a716-446655440001',
          eventType: 'account_connected',
          description: 'Connected user@example.com',
          createdAt: '2026-11-20T10:00:00.000Z',
          mailAccountId: '550e8400-e29b-41d4-a716-446655440000',
        },
      ],
    });
    expect(overview.totalConnected).toBe(3);
    expect(overview.slotCapacity).toBe(20);
    expect(overview.recentActivity.length).toBe(1);
  });

  it('validates CompleteMailOAuthInput strictly', () => {
    const input = CompleteMailOAuthInputSchema.parse({
      code: 'oauth_code_456',
      state: 'oauth_state_123',
    });
    expect(input.code).toBe('oauth_code_456');

    expect(() =>
      CompleteMailOAuthInputSchema.parse({
        code: '',
        state: 'oauth_state_123',
      }),
    ).toThrow();
  });

  it('validates InitiateMailOAuthResponse strictly', () => {
    const res = InitiateMailOAuthResponseSchema.parse({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=123',
      state: 'state12345',
    });
    expect(res.authorizationUrl).toContain('https://accounts.google.com');
  });

  it('validates MailHealthCheckResponse strictly', () => {
    const health = MailHealthCheckResponseSchema.parse({
      accountId: '550e8400-e29b-41d4-a716-446655440000',
      status: 'connected',
      healthy: true,
      message: 'Connection active and responsive',
      checkedAt: '2026-11-20T12:00:00.000Z',
      lastSyncAt: '2026-11-20T12:00:00.000Z',
    });
    expect(health.healthy).toBe(true);
  });
});
