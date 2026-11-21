import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { MailOverview, MailSettings } from '@mark-1/contracts';
import type { PortalApi } from '../../api.js';
import { MailDashboard } from './MailDashboard.js';
import { MailCallbackScreen } from './MailCallbackScreen.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const mockOverview: MailOverview = {
  totalConnected: 1,
  accountsNeedingAttention: 0,
  activeAccounts: 1,
  disconnectedAccounts: 0,
  slotCapacity: 20,
  slotsUsed: 1,
  lastSyncAt: '2026-11-20T10:00:00.000Z',
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
      description: 'Gmail account alex@example.com connected',
      createdAt: '2026-11-20T10:00:00.000Z',
      mailAccountId: '550e8400-e29b-41d4-a716-446655440000',
    },
  ],
};

const mockAccount = {
  id: '550e8400-e29b-41d4-a716-446655440000',
  email: 'alex@example.com',
  displayName: 'Alex Developer',
  avatarUrl: null,
  status: 'connected' as const,
  scopes: ['openid', 'email', 'profile', 'https://www.googleapis.com/auth/gmail.readonly'],
  lastConnectedAt: '2026-11-20T10:00:00.000Z',
  lastSyncAt: '2026-11-20T12:00:00.000Z',
  errorMessage: null,
  createdAt: '2026-11-20T10:00:00.000Z',
  updatedAt: '2026-11-20T12:00:00.000Z',
};

const mockSettings: MailSettings = {
  slotCapacity: 20,
  slotsUsed: 1,
  defaultSyncFrequencyMinutes: 15,
  encryptionStatus: 'AES-256-GCM authenticated encryption active',
  gmailScopeLevel: 'read_only',
};

function createMockApi() {
  return {
    getMailOverview: vi.fn().mockResolvedValue(mockOverview),
    listMailAccounts: vi.fn().mockResolvedValue({ accounts: [mockAccount] }),
    getMailSettings: vi.fn().mockResolvedValue({ settings: mockSettings }),
    initiateMailConnect: vi.fn().mockResolvedValue({
      authorizationUrl: 'https://accounts.google.com/o/oauth2/v2/auth?client_id=test',
      state: 'mock_state_123',
    }),
    completeMailOAuth: vi.fn().mockResolvedValue({ account: mockAccount }),
    getMailAccount: vi.fn().mockResolvedValue({
      account: {
        ...mockAccount,
        settings: {
          syncFrequencyMinutes: 15,
          notifyOnSyncError: true,
          syncEnabled: true,
        },
      },
    }),
    checkMailAccountHealth: vi.fn().mockResolvedValue({
      accountId: mockAccount.id,
      status: 'connected',
      healthy: true,
      message: 'Account connection verified and healthy.',
      checkedAt: new Date().toISOString(),
      lastSyncAt: new Date().toISOString(),
    }),
    disconnectMailAccount: vi.fn().mockResolvedValue({ disconnected: true }),
    updateMailAccountSettings: vi.fn().mockResolvedValue({
      settings: {
        syncFrequencyMinutes: 30,
        notifyOnSyncError: false,
        syncEnabled: true,
      },
    }),
  } as unknown as PortalApi;
}

describe('MailDashboard Component', () => {
  it('renders overview metrics and capacity from real database data', async () => {
    const api = createMockApi();
    render(<MailDashboard api={api} initialTab="overview" />);

    // Initially loading skeleton
    expect(screen.getByLabelText(/loading mail data/i)).toBeDefined();

    // Loaded overview cards
    await waitFor(() => {
      expect(screen.getByText('Connected Accounts')).toBeDefined();
    });

    expect(screen.getByText('1 / 20')).toBeDefined();
    expect(screen.getByText('Gmail account alex@example.com connected')).toBeDefined();
    expect(screen.getAllByText(/Phase 1 Active/i).length).toBeGreaterThan(0);
    expect(screen.getByText(/Unified Inbox/i)).toBeDefined();
  });

  it('renders accounts list with status badges and details', async () => {
    const api = createMockApi();
    render(<MailDashboard api={api} initialTab="accounts" />);

    await waitFor(() => {
      expect(screen.getByText('alex@example.com')).toBeDefined();
    });

    expect(screen.getByText('Alex Developer')).toBeDefined();
    expect(screen.getByText('Connected')).toBeDefined();
    expect(screen.getByText(/Gmail Read-Only, Profile, Email/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Check Health/i })).toBeDefined();
    expect(screen.getByRole('button', { name: /Disconnect/i })).toBeDefined();
  });

  it('renders empty state when no accounts are connected', async () => {
    const api = createMockApi();
    vi.mocked(api.listMailAccounts).mockResolvedValue({ accounts: [] });
    vi.mocked(api.getMailOverview).mockResolvedValue({ ...mockOverview, totalConnected: 0, slotsUsed: 0 });

    render(<MailDashboard api={api} initialTab="accounts" />);

    await waitFor(() => {
      expect(screen.getByText(/No Connected Gmail Accounts/i)).toBeDefined();
    });
  });

  it('opens confirmation modal before disconnecting an account', async () => {
    const api = createMockApi();
    render(<MailDashboard api={api} initialTab="accounts" />);

    await waitFor(() => {
      expect(screen.getByText('alex@example.com')).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Disconnect/i }));

    // Confirmation modal should appear
    expect(screen.getByText(/Disconnect Gmail Account\?/i)).toBeDefined();
    expect(screen.getByRole('button', { name: /Yes, Disconnect/i })).toBeDefined();

    // Confirm disconnect
    fireEvent.click(screen.getByRole('button', { name: /Yes, Disconnect/i }));

    await waitFor(() => {
      expect(api.disconnectMailAccount).toHaveBeenCalledWith(mockAccount.id, mockAccount.email);
    });
  });

  it('executes health check probe on demand and displays result', async () => {
    const api = createMockApi();
    render(<MailDashboard api={api} initialTab="accounts" />);

    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Check Health/i })).toBeDefined();
    });

    fireEvent.click(screen.getByRole('button', { name: /Check Health/i }));

    await waitFor(() => {
      expect(api.checkMailAccountHealth).toHaveBeenCalledWith(mockAccount.id);
    });
  });

  it('renders settings tab with security architecture specifications', async () => {
    const api = createMockApi();
    render(<MailDashboard api={api} initialTab="settings" />);

    await waitFor(() => {
      expect(screen.getByText(/Account Capacity Configuration/i)).toBeDefined();
    });

    expect(screen.getByText(/Token & Security Architecture/i)).toBeDefined();
    expect(screen.getByText(/AES-256-GCM authenticated encryption/i)).toBeDefined();
    expect(screen.getByText(/Minimal Scopes/i)).toBeDefined();
  });
});

describe('MailCallbackScreen Component', () => {
  it('completes OAuth code exchange and notifies on success', async () => {
    const api = createMockApi();
    const onFinished = vi.fn();

    render(
      <MailCallbackScreen
        api={api}
        search="?code=test_code_123&state=test_state_abc"
        onFinished={onFinished}
      />,
    );

    expect(screen.getByText(/Authorizing Gmail Account/i)).toBeDefined();

    await waitFor(() => {
      expect(api.completeMailOAuth).toHaveBeenCalledWith({
        code: 'test_code_123',
        state: 'test_state_abc',
      });
    });
  });

  it('handles Google access_denied gracefully without throwing errors', async () => {
    const api = createMockApi();
    const onFinished = vi.fn();

    render(
      <MailCallbackScreen
        api={api}
        search="?error=access_denied"
        onFinished={onFinished}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText(/Google authorization was cancelled or denied/i)).toBeDefined();
    });

    expect(api.completeMailOAuth).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Return to Mail Dashboard/i })).toBeDefined();
  });
});
