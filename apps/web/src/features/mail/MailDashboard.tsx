import React, { useCallback, useEffect, useState } from 'react';
import type {
  MailAccountDetail,
  MailAccountSettings,
  MailAccountSummary,
  MailHealthCheckResponse,
  MailOverview,
  MailSettings,
} from '@mark-1/contracts';
import type { PortalApi } from '../../api.js';

export type MailTab =
  | 'overview'
  | 'accounts'
  | 'inbox'
  | 'compose'
  | 'drafts'
  | 'queue'
  | 'templates'
  | 'settings';

interface MailDashboardProps {
  api: PortalApi;
  initialTab?: MailTab;
  onNavigatePortal?: () => void;
}

export function MailDashboard({ api, initialTab = 'overview', onNavigatePortal }: MailDashboardProps) {
  const [activeTab, setActiveTab] = useState<MailTab>(initialTab);
  const [overview, setOverview] = useState<MailOverview | null>(null);
  const [accounts, setAccounts] = useState<MailAccountSummary[]>([]);
  const [mailSettings, setMailSettings] = useState<MailSettings | null>(null);
  const [loading, setLoading] = useState(true);
  const [errorNotice, setErrorNotice] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState(false);

  // Modals state
  const [disconnectingAccount, setDisconnectingAccount] = useState<MailAccountSummary | null>(null);
  const [inspectingAccount, setInspectingAccount] = useState<MailAccountDetail | null>(null);
  const [healthStatusMap, setHealthStatusMap] = useState<Record<string, MailHealthCheckResponse>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    setErrorNotice(null);
    try {
      const [ov, accList, sett] = await Promise.all([
        api.getMailOverview(),
        api.listMailAccounts(),
        api.getMailSettings(),
      ]);
      setOverview(ov);
      setAccounts(accList.accounts);
      setMailSettings(sett.settings);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Could not load mail data');
    } finally {
      setLoading(false);
    }
  }, [api]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const handleConnectGmail = async (targetAccountId?: string) => {
    setActionBusy(true);
    setErrorNotice(null);
    try {
      const res = targetAccountId
        ? await api.initiateMailReconnect(targetAccountId)
        : await api.initiateMailConnect();
      if (typeof window !== 'undefined' && res.authorizationUrl) {
        window.location.href = res.authorizationUrl;
      }
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to initiate Google OAuth');
      setActionBusy(false);
    }
  };

  const handleCheckHealth = async (accountId: string) => {
    setActionBusy(true);
    setErrorNotice(null);
    try {
      const health = await api.checkMailAccountHealth(accountId);
      setHealthStatusMap((prev) => ({ ...prev, [accountId]: health }));
      setSuccessNotice(`Health check completed: ${health.message}`);
      await loadData();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Health check failed');
    } finally {
      setActionBusy(false);
    }
  };

  const handleConfirmDisconnect = async () => {
    if (!disconnectingAccount) return;
    setActionBusy(true);
    setErrorNotice(null);
    try {
      await api.disconnectMailAccount(disconnectingAccount.id, disconnectingAccount.email);
      setSuccessNotice(`Disconnected ${disconnectingAccount.email}`);
      setDisconnectingAccount(null);
      await loadData();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to disconnect account');
    } finally {
      setActionBusy(false);
    }
  };

  const handleOpenAccountDetails = async (accountId: string) => {
    setActionBusy(true);
    try {
      const { account } = await api.getMailAccount(accountId);
      setInspectingAccount(account);
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to load account details');
    } finally {
      setActionBusy(false);
    }
  };

  const handleSaveAccountSettings = async (
    accountId: string,
    updates: Partial<MailAccountSettings>,
  ) => {
    setActionBusy(true);
    setErrorNotice(null);
    try {
      await api.updateMailAccountSettings(accountId, updates);
      setSuccessNotice('Account synchronization settings updated');
      setInspectingAccount(null);
      await loadData();
    } catch (err) {
      setErrorNotice(err instanceof Error ? err.message : 'Failed to update settings');
    } finally {
      setActionBusy(false);
    }
  };

  return (
    <div className="mail-dashboard-container">
      {/* Top Header */}
      <header className="mail-header">
        <div className="mail-header-title">
          <div className="mail-badge">PHASE 1 ACTIVE</div>
          <h2>MARK-1 MAIL</h2>
          <p>Multi-account Gmail workspace & synchronization manager</p>
        </div>
        <div className="mail-header-actions">
          {onNavigatePortal && (
            <button
              type="button"
              className="mail-btn mail-btn-secondary"
              onClick={onNavigatePortal}
            >
              Back to Portal
            </button>
          )}
          <button
            type="button"
            className="mail-btn mail-btn-primary"
            disabled={actionBusy || (overview ? overview.slotsUsed >= overview.slotCapacity : false)}
            onClick={() => handleConnectGmail()}
          >
            + Connect Gmail
          </button>
        </div>
      </header>

      {/* Notifications */}
      {errorNotice && (
        <div className="mail-notice mail-notice-error" role="alert">
          <span>{errorNotice}</span>
          <button type="button" onClick={() => setErrorNotice(null)}>✕</button>
        </div>
      )}
      {successNotice && (
        <div className="mail-notice mail-notice-success" role="status">
          <span>{successNotice}</span>
          <button type="button" onClick={() => setSuccessNotice(null)}>✕</button>
        </div>
      )}

      {/* Navigation Tabs */}
      <nav className="mail-nav-tabs" aria-label="Mail sections">
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'overview' ? 'active' : ''}`}
          onClick={() => setActiveTab('overview')}
        >
          Overview
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'accounts' ? 'active' : ''}`}
          onClick={() => setActiveTab('accounts')}
        >
          Accounts ({accounts.filter((a) => a.status !== 'disconnected').length}/20)
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'inbox' ? 'active' : ''}`}
          onClick={() => setActiveTab('inbox')}
        >
          Inbox <span className="mail-pill-tag">Phase 2</span>
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'compose' ? 'active' : ''}`}
          onClick={() => setActiveTab('compose')}
        >
          Compose <span className="mail-pill-tag">Phase 3</span>
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'drafts' ? 'active' : ''}`}
          onClick={() => setActiveTab('drafts')}
        >
          Drafts
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'queue' ? 'active' : ''}`}
          onClick={() => setActiveTab('queue')}
        >
          Queue <span className="mail-pill-tag">Phase 4</span>
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'templates' ? 'active' : ''}`}
          onClick={() => setActiveTab('templates')}
        >
          Templates
        </button>
        <button
          type="button"
          className={`mail-tab-item ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          Settings
        </button>
      </nav>

      {/* Main Tab Content */}
      <div className="mail-tab-content">
        {loading ? (
          <div className="mail-loading-skeleton" aria-label="Loading mail data">
            <div className="skeleton-bar" style={{ width: '60%', height: '24px' }} />
            <div className="skeleton-grid">
              <div className="skeleton-card" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
              <div className="skeleton-card" />
            </div>
          </div>
        ) : (
          <>
            {activeTab === 'overview' && (
              <OverviewView
                overview={overview}
                accounts={accounts}
                onConnect={() => handleConnectGmail()}
                onViewAccounts={() => setActiveTab('accounts')}
                onRefresh={() => void loadData()}
              />
            )}

            {activeTab === 'accounts' && (
              <AccountsManagerView
                accounts={accounts}
                overview={overview}
                healthMap={healthStatusMap}
                busy={actionBusy}
                onConnect={() => handleConnectGmail()}
                onReconnect={(id) => handleConnectGmail(id)}
                onCheckHealth={handleCheckHealth}
                onInspectAccount={handleOpenAccountDetails}
                onRequestDisconnect={(acc) => setDisconnectingAccount(acc)}
              />
            )}

            {activeTab === 'inbox' && <PlaceholderView title="Inbox" phase="Phase 2" />}
            {activeTab === 'compose' && <PlaceholderView title="Compose" phase="Phase 3" />}
            {activeTab === 'drafts' && <DraftsView />}
            {activeTab === 'queue' && <PlaceholderView title="Outbox Queue" phase="Phase 4" />}
            {activeTab === 'templates' && <TemplatesView />}
            {activeTab === 'settings' && (
              <SettingsView
                settings={mailSettings}
                accounts={accounts}
                onManageAccounts={() => setActiveTab('accounts')}
              />
            )}
          </>
        )}
      </div>

      {/* Disconnect Confirmation Modal */}
      {disconnectingAccount && (
        <div className="mail-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="modal-title">
          <div className="mail-modal-card">
            <h3 id="modal-title">Disconnect Gmail Account?</h3>
            <p>
              Are you sure you want to disconnect <strong>{disconnectingAccount.email}</strong>?
            </p>
            <p className="mail-text-muted">
              This action revokes Google OAuth authorization and permanently purges stored access and
              refresh tokens from the MARK-1 backend.
            </p>
            <div className="mail-modal-actions">
              <button
                type="button"
                className="mail-btn mail-btn-danger"
                disabled={actionBusy}
                onClick={handleConfirmDisconnect}
              >
                {actionBusy ? 'Disconnecting…' : 'Yes, Disconnect'}
              </button>
              <button
                type="button"
                className="mail-btn mail-btn-secondary"
                disabled={actionBusy}
                onClick={() => setDisconnectingAccount(null)}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Account Details & Settings Modal */}
      {inspectingAccount && (
        <AccountDetailsModal
          account={inspectingAccount}
          busy={actionBusy}
          onClose={() => setInspectingAccount(null)}
          onSaveSettings={(updates) => handleSaveAccountSettings(inspectingAccount.id, updates)}
        />
      )}
    </div>
  );
}

/* ----------------- SUB-VIEWS ----------------- */

function OverviewView({
  overview,
  accounts,
  onConnect,
  onViewAccounts,
  onRefresh,
}: {
  overview: MailOverview | null;
  accounts: MailAccountSummary[];
  onConnect: () => void;
  onViewAccounts: () => void;
  onRefresh: () => void;
}) {
  const total = overview?.totalConnected ?? accounts.length;
  const attention = overview?.accountsNeedingAttention ?? 0;
  const used = overview?.slotsUsed ?? accounts.filter((a) => a.status !== 'disconnected').length;
  const capacity = overview?.slotCapacity ?? 20;
  const percentage = Math.min(100, Math.round((used / capacity) * 100));

  return (
    <div className="mail-overview-grid">
      {/* 4 Widget Cards */}
      <div className="mail-widget-card">
        <div className="widget-label">Connected Accounts</div>
        <div className="widget-value">{total}</div>
        <div className="widget-footer">{used} active slots used</div>
      </div>

      <div className="mail-widget-card">
        <div className="widget-label">Attention Needed</div>
        <div className={`widget-value ${attention > 0 ? 'text-danger' : 'text-success'}`}>
          {attention}
        </div>
        <div className="widget-footer">
          {attention > 0 ? 'Re-authorization or error detected' : 'All accounts operational'}
        </div>
      </div>

      <div className="mail-widget-card">
        <div className="widget-label">Capacity (Initial Target)</div>
        <div className="widget-value">{used} / {capacity}</div>
        <div className="widget-progress-container">
          <div className="widget-progress-bar" style={{ width: `${percentage}%` }} />
        </div>
      </div>

      <div className="mail-widget-card">
        <div className="widget-label">Last Synchronization</div>
        <div className="widget-value-sm">
          {overview?.lastSyncAt ? new Date(overview.lastSyncAt).toLocaleString() : 'No sync recorded'}
        </div>
        <div className="widget-footer">Read-only metadata probe</div>
      </div>

      {/* Quick Actions Card */}
      <div className="mail-card mail-col-span-full">
        <h3>Quick Actions</h3>
        <div className="mail-quick-actions">
          <button type="button" className="mail-btn mail-btn-primary" onClick={onConnect}>
            + Connect New Account
          </button>
          <button type="button" className="mail-btn mail-btn-secondary" onClick={onViewAccounts}>
            View All Accounts
          </button>
          <button type="button" className="mail-btn mail-btn-secondary" onClick={onRefresh}>
            Refresh Dashboard
          </button>
        </div>
      </div>

      {/* Modules Availability & Activity Grid */}
      <div className="mail-card mail-col-span-6">
        <h3>Email Modules Status</h3>
        <ul className="mail-status-list">
          <li>
            <span className="status-name">Mail Accounts Manager</span>
            <span className="status-badge badge-active">Phase 1 Active</span>
          </li>
          <li>
            <span className="status-name">Token Cryptography & OAuth</span>
            <span className="status-badge badge-active">AES-256-GCM Verified</span>
          </li>
          <li>
            <span className="status-name">Drafts & Templates</span>
            <span className="status-badge badge-active">Phase 1 Foundations</span>
          </li>
          <li>
            <span className="status-name">Unified Inbox</span>
            <span className="status-badge badge-planned">Phase 2 Scheduled</span>
          </li>
          <li>
            <span className="status-name">Smart Compose</span>
            <span className="status-badge badge-planned">Phase 3 Scheduled</span>
          </li>
          <li>
            <span className="status-name">Dispatch Queue & Throttling</span>
            <span className="status-badge badge-planned">Phase 4 Scheduled</span>
          </li>
        </ul>
      </div>

      <div className="mail-card mail-col-span-6">
        <h3>Recent Mail Audit Activity</h3>
        {overview?.recentActivity && overview.recentActivity.length > 0 ? (
          <ul className="mail-audit-list">
            {overview.recentActivity.map((evt) => (
              <li key={evt.id} className="mail-audit-item">
                <div className="audit-desc">{evt.description}</div>
                <div className="audit-time">{new Date(evt.createdAt).toLocaleTimeString()}</div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mail-text-muted">No recent mail activity recorded.</p>
        )}
      </div>
    </div>
  );
}

function AccountsManagerView({
  accounts,
  overview,
  healthMap,
  busy,
  onConnect,
  onReconnect,
  onCheckHealth,
  onInspectAccount,
  onRequestDisconnect,
}: {
  accounts: MailAccountSummary[];
  overview: MailOverview | null;
  healthMap: Record<string, MailHealthCheckResponse>;
  busy: boolean;
  onConnect: () => void;
  onReconnect: (id: string) => void;
  onCheckHealth: (id: string) => void;
  onInspectAccount: (id: string) => void;
  onRequestDisconnect: (acc: MailAccountSummary) => void;
}) {
  const used = overview?.slotsUsed ?? accounts.filter((a) => a.status !== 'disconnected').length;
  const capacity = overview?.slotCapacity ?? 20;

  return (
    <div className="mail-accounts-view">
      {/* Capacity Indicator Banner */}
      <div className="mail-capacity-banner">
        <div className="capacity-info">
          <h4>Account Capacity</h4>
          <p>
            {used} of {capacity} slots occupied. Each account is individually authorized via Google OAuth 2.0 with
            strict minimal read-only permissions.
          </p>
        </div>
        <button
          type="button"
          className="mail-btn mail-btn-primary"
          disabled={busy || used >= capacity}
          onClick={onConnect}
        >
          + Connect Gmail Account
        </button>
      </div>

      {/* Account List */}
      {accounts.length === 0 ? (
        <div className="mail-empty-state">
          <div className="empty-icon">✉</div>
          <h3>No Connected Gmail Accounts</h3>
          <p>
            Connect your first Gmail account to begin managing your mailboxes securely.
            Tokens are encrypted at rest using AES-256-GCM and never returned to the frontend.
          </p>
          <button type="button" className="mail-btn mail-btn-primary" disabled={busy} onClick={onConnect}>
            Connect Gmail Account
          </button>
        </div>
      ) : (
        <div className="mail-account-cards">
          {accounts.map((acc) => {
            const health = healthMap[acc.id];
            const isDisconnected = acc.status === 'disconnected';

            return (
              <div key={acc.id} className={`mail-account-card ${isDisconnected ? 'disconnected' : ''}`}>
                <div className="card-top">
                  <div className="account-identity">
                    {acc.avatarUrl ? (
                      <img src={acc.avatarUrl} alt="" className="account-avatar" />
                    ) : (
                      <div className="account-avatar-placeholder">
                        {acc.displayName ? acc.displayName[0]?.toUpperCase() : acc.email[0]?.toUpperCase()}
                      </div>
                    )}
                    <div className="account-meta">
                      <div className="account-email">{acc.email}</div>
                      <div className="account-name">{acc.displayName ?? 'No display name'}</div>
                    </div>
                  </div>
                  <div className="account-status">
                    <span className={`status-pill status-${acc.status}`}>
                      {acc.status === 'connected'
                        ? 'Connected'
                        : acc.status === 'needs_reauth'
                          ? 'Needs Re-auth'
                          : acc.status === 'error'
                            ? 'Error'
                            : 'Disconnected'}
                    </span>
                  </div>
                </div>

                <div className="card-details">
                  <div className="detail-row">
                    <span className="detail-label">Scopes:</span>
                    <span className="detail-val">
                      {acc.scopes.some((s) => s.includes('gmail.readonly'))
                        ? 'Gmail Read-Only, Profile, Email'
                        : 'Profile, Email'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Connected:</span>
                    <span className="detail-val">
                      {acc.lastConnectedAt ? new Date(acc.lastConnectedAt).toLocaleDateString() : '—'}
                    </span>
                  </div>
                  <div className="detail-row">
                    <span className="detail-label">Last Sync:</span>
                    <span className="detail-val">
                      {acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleTimeString() : 'Never'}
                    </span>
                  </div>
                  {acc.errorMessage && (
                    <div className="detail-error">
                      <strong>Issue:</strong> {acc.errorMessage}
                    </div>
                  )}
                  {health && (
                    <div className={`detail-health ${health.healthy ? 'health-ok' : 'health-bad'}`}>
                      {health.message}
                    </div>
                  )}
                </div>

                <div className="card-actions">
                  {!isDisconnected ? (
                    <>
                      <button
                        type="button"
                        className="mail-btn mail-btn-sm mail-btn-secondary"
                        disabled={busy}
                        onClick={() => onCheckHealth(acc.id)}
                      >
                        Check Health
                      </button>
                      <button
                        type="button"
                        className="mail-btn mail-btn-sm mail-btn-secondary"
                        disabled={busy}
                        onClick={() => onInspectAccount(acc.id)}
                      >
                        Details & Settings
                      </button>
                      <button
                        type="button"
                        className="mail-btn mail-btn-sm mail-btn-secondary"
                        disabled={busy}
                        onClick={() => onReconnect(acc.id)}
                      >
                        Reconnect
                      </button>
                      <button
                        type="button"
                        className="mail-btn mail-btn-sm mail-btn-danger"
                        disabled={busy}
                        onClick={() => onRequestDisconnect(acc)}
                      >
                        Disconnect
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="mail-btn mail-btn-sm mail-btn-primary"
                      disabled={busy}
                      onClick={() => onReconnect(acc.id)}
                    >
                      Reconnect Account
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function AccountDetailsModal({
  account,
  busy,
  onClose,
  onSaveSettings,
}: {
  account: MailAccountDetail;
  busy: boolean;
  onClose: () => void;
  onSaveSettings: (updates: Partial<MailAccountSettings>) => void;
}) {
  const [freq, setFreq] = useState(account.settings.syncFrequencyMinutes);
  const [notify, setNotify] = useState(account.settings.notifyOnSyncError);
  const [enabled, setEnabled] = useState(account.settings.syncEnabled);

  return (
    <div className="mail-modal-backdrop" role="dialog" aria-modal="true" aria-labelledby="detail-title">
      <div className="mail-modal-card mail-modal-wide">
        <h3 id="detail-title">Account Details & Settings</h3>
        <div className="account-details-grid">
          <div>
            <label>Email Address</label>
            <p className="detail-static">{account.email}</p>
          </div>
          <div>
            <label>Display Name</label>
            <p className="detail-static">{account.displayName ?? 'None'}</p>
          </div>
          <div>
            <label>Account ID</label>
            <p className="detail-static monospace">{account.id}</p>
          </div>
          <div>
            <label>Connection Status</label>
            <p className="detail-static">{account.status.toUpperCase()}</p>
          </div>
          <div>
            <label>Granted OAuth Scopes</label>
            <ul className="detail-scopes-list">
              {account.scopes.map((s) => (
                <li key={s} className="monospace">{s}</li>
              ))}
            </ul>
          </div>
        </div>

        <hr className="mail-divider" />

        <h4>Synchronization Preferences</h4>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            onSaveSettings({
              syncFrequencyMinutes: freq,
              notifyOnSyncError: notify,
              syncEnabled: enabled,
            });
          }}
        >
          <div className="form-group">
            <label htmlFor="sync-freq">Sync Frequency</label>
            <select
              id="sync-freq"
              value={freq}
              onChange={(e) => setFreq(Number(e.target.value))}
              disabled={busy}
            >
              <option value={5}>Every 5 minutes</option>
              <option value={15}>Every 15 minutes (Default)</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every 1 hour</option>
              <option value={1440}>Once a day</option>
            </select>
          </div>

          <div className="form-checkbox">
            <input
              id="notify-sync"
              type="checkbox"
              checked={notify}
              onChange={(e) => setNotify(e.target.checked)}
              disabled={busy}
            />
            <label htmlFor="notify-sync">Notify me on sync failures</label>
          </div>

          <div className="form-checkbox">
            <input
              id="enable-sync"
              type="checkbox"
              checked={enabled}
              onChange={(e) => setEnabled(e.target.checked)}
              disabled={busy}
            />
            <label htmlFor="enable-sync">Enable automatic synchronization probe</label>
          </div>

          <div className="mail-modal-actions">
            <button type="submit" className="mail-btn mail-btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save Settings'}
            </button>
            <button type="button" className="mail-btn mail-btn-secondary" disabled={busy} onClick={onClose}>
              Close
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

function SettingsView({
  settings,
  accounts,
  onManageAccounts,
}: {
  settings: MailSettings | null;
  accounts: MailAccountSummary[];
  onManageAccounts: () => void;
}) {
  return (
    <div className="mail-settings-container">
      <div className="mail-card">
        <h3>Account Capacity Configuration</h3>
        <p className="mail-text-muted">
          Initial architecture target: 20 account slots. Each mailbox must be individually authorized by its owner.
        </p>
        <div className="capacity-display">
          <div className="capacity-metric">
            <span className="metric-number">{settings?.slotsUsed ?? accounts.filter((a) => a.status !== 'disconnected').length}</span>
            <span className="metric-label">Slots Utilized</span>
          </div>
          <div className="capacity-metric">
            <span className="metric-number">{settings?.slotCapacity ?? 20}</span>
            <span className="metric-label">Total Allocated Slots</span>
          </div>
        </div>
        <button type="button" className="mail-btn mail-btn-secondary" onClick={onManageAccounts}>
          Manage Connected Accounts
        </button>
      </div>

      <div className="mail-card">
        <h3>Token & Security Architecture</h3>
        <ul className="mail-security-checklist">
          <li>
            <strong>Encryption at Rest:</strong> OAuth access & refresh tokens are encrypted using AES-256-GCM authenticated encryption on the backend before storage.
          </li>
          <li>
            <strong>Zero Frontend Leakage:</strong> Raw OAuth tokens, refresh tokens, and encryption keys are strictly retained on the backend and never emitted to browser storage, URLs, or API responses.
          </li>
          <li>
            <strong>Minimal Scopes:</strong> Requesting solely <code>gmail.readonly</code>, <code>userinfo.email</code>, and <code>userinfo.profile</code>. No send permissions are permitted in Phase 1.
          </li>
          <li>
            <strong>PKCE & CSRF Defense:</strong> Every authorization code flow leverages single-use SHA-256 PKCE code challenges and cryptographically generated session-bound states.
          </li>
        </ul>
      </div>

      <div className="mail-card">
        <h3>Synchronization Preferences</h3>
        <p className="mail-text-muted">
          Default background synchronization interval: {settings?.defaultSyncFrequencyMinutes ?? 15} minutes.
          Full automatic synchronization worker daemon will activate in Phase 2.
        </p>
      </div>
    </div>
  );
}

function DraftsView() {
  return (
    <div className="mail-card">
      <h3>Drafts</h3>
      <p className="mail-text-muted">
        Drafts foundation ready. In Phase 3, drafts will synchronize across connected accounts.
      </p>
      <div className="mail-empty-state">
        <p>No active drafts created yet.</p>
      </div>
    </div>
  );
}

function TemplatesView() {
  return (
    <div className="mail-card">
      <h3>Templates</h3>
      <p className="mail-text-muted">
        Reusable email templates for personal, business, and support communication.
      </p>
      <div className="mail-empty-state">
        <p>No templates created yet.</p>
      </div>
    </div>
  );
}

function PlaceholderView({ title, phase }: { title: string; phase: string }) {
  return (
    <div className="mail-card mail-placeholder-view">
      <div className="placeholder-badge">{phase} PREVIEW</div>
      <h3>{title}</h3>
      <p className="mail-text-muted">
        The {title} module is scheduled for development in {phase}. Phase 1 establishes the multi-account
        Gmail OAuth authorization and credential security foundation required to power this view.
      </p>
    </div>
  );
}
