import { describe, expect, it } from 'vitest';
import type { AuthUser } from '@mark-1/contracts';
import { MemoryMailDatabase, validateEncryptionKey } from '@mark-1/db';
import { MockGoogleOAuthClient } from '../google-client.js';
import { MailError, MailService } from '../service.js';

const testKey = validateEncryptionKey('0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef');

const userA: AuthUser = {
  id: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
  email: 'usera@example.test',
  emailVerified: true,
  role: 'customer',
};

const userB: AuthUser = {
  id: 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb',
  email: 'userb@example.test',
  emailVerified: true,
  role: 'customer',
};

function setupService(maxAccounts = 20) {
  const database = new MemoryMailDatabase();
  const googleClient = new MockGoogleOAuthClient();
  const service = new MailService({
    database,
    googleClient,
    encryptionKey: testKey,
    clientId: 'google-client-id-test',
    clientSecret: 'google-client-secret-test',
    defaultRedirectUri: 'http://localhost:5173/mail/callback',
    maxAccountsPerUser: maxAccounts,
  });

  return { database, googleClient, service };
}

describe('MailService unit & security tests', () => {
  it('generates PKCE and secure state on initiateConnect', async () => {
    const { database, service } = setupService();

    const { authorizationUrl, state } = await service.initiateConnect(userA);

    expect(authorizationUrl).toContain('https://mock.google.auth/auth');
    expect(authorizationUrl).toContain('client_id=google-client-id-test');
    expect(authorizationUrl).toContain(`state=${state}`);
    expect(state.length).toBe(64); // 32 bytes hex
    expect(database.states.size).toBe(1);
  });

  it('completes OAuth callback, validates state single-use and encrypts tokens', async () => {
    const { database, googleClient, service } = setupService();

    const { state } = await service.initiateConnect(userA);

    // Prepare mock Google response
    const mockCode = 'valid_oauth_code_123';
    googleClient.exchangeResponses.set(mockCode, {
      accessToken: 'google_raw_access_token_xyz',
      refreshToken: 'google_raw_refresh_token_abc',
      expiresIn: 3600,
      tokenType: 'Bearer',
      scope: 'openid email profile https://www.googleapis.com/auth/gmail.readonly',
    });

    googleClient.userInfos.set('google_raw_access_token_xyz', {
      id: 'google-user-id-999',
      email: 'work.google@company.com',
      name: 'Work User',
      picture: 'https://lh3.googleusercontent.com/avatar',
    });

    const account = await service.completeCallback(userA, {
      code: mockCode,
      state,
    });

    expect(account.email).toBe('work.google@company.com');
    expect(account.displayName).toBe('Work User');
    expect(account.status).toBe('connected');

    // Verify zero secret leakage in returned object
    expect(account).not.toHaveProperty('accessToken');
    expect(account).not.toHaveProperty('refreshToken');
    expect(account).not.toHaveProperty('encryptedAccessToken');

    // Verify tokens in DB are encrypted and NEVER stored plaintext
    const creds = await database.getAccountCredentials(userA.id, account.id);
    expect(creds?.encryptedAccessToken).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(creds?.encryptedAccessToken).not.toContain('google_raw_access_token_xyz');
    expect(creds?.encryptedRefreshToken).toMatch(/^v1:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+:[A-Za-z0-9_-]+$/);
    expect(creds?.encryptedRefreshToken).not.toContain('google_raw_refresh_token_abc');

    // Verify single-use state consumption: replay attempt fails
    await expect(
      service.completeCallback(userA, {
        code: mockCode,
        state,
      }),
    ).rejects.toThrowError(MailError);
  });

  it('prevents cross-user state theft (CSRF / session binding)', async () => {
    const { googleClient, service } = setupService();

    // User A initiates OAuth
    const { state } = await service.initiateConnect(userA);

    googleClient.exchangeResponses.set('code_steal', {
      accessToken: 'token_steal',
      expiresIn: 3600,
    });
    googleClient.userInfos.set('token_steal', {
      id: 'g-steal',
      email: 'stolen@example.com',
    });

    // User B attempts to complete callback using User A's state
    await expect(
      service.completeCallback(userB, {
        code: 'code_steal',
        state,
      }),
    ).rejects.toThrowError(/OAuth state does not match/i);
  });

  it('strictly enforces 20-slot account capacity limit', async () => {
    const { googleClient, service } = setupService(2); // Set max capacity to 2 for test

    // Connect 1st account
    const { state: s1 } = await service.initiateConnect(userA);
    googleClient.exchangeResponses.set('c1', { accessToken: 't1', expiresIn: 3600 });
    googleClient.userInfos.set('t1', { id: 'g1', email: 'acc1@gmail.com' });
    await service.completeCallback(userA, { code: 'c1', state: s1 });

    // Connect 2nd account
    const { state: s2 } = await service.initiateConnect(userA);
    googleClient.exchangeResponses.set('c2', { accessToken: 't2', expiresIn: 3600 });
    googleClient.userInfos.set('t2', { id: 'g2', email: 'acc2@gmail.com' });
    await service.completeCallback(userA, { code: 'c2', state: s2 });

    // Attempt to connect 3rd account (exceeds capacity of 2)
    await expect(service.initiateConnect(userA)).rejects.toThrowError(/capacity limit/i);
  });

  it('allows reconnect of existing account without increasing slot count', async () => {
    const { googleClient, service } = setupService(2);

    // Connect account
    const { state: s1 } = await service.initiateConnect(userA);
    googleClient.exchangeResponses.set('c1', { accessToken: 't1', expiresIn: 3600 });
    googleClient.userInfos.set('t1', { id: 'g1', email: 'reconnect.test@gmail.com', name: 'Original Name' });
    const acc = await service.completeCallback(userA, { code: 'c1', state: s1 });

    // Reconnect target account
    const { state: s2 } = await service.initiateConnect(userA, undefined, acc.id);
    googleClient.exchangeResponses.set('c2', { accessToken: 't2', expiresIn: 3600 });
    googleClient.userInfos.set('t2', { id: 'g1', email: 'reconnect.test@gmail.com', name: 'Updated Name' });
    const reconnected = await service.completeCallback(userA, { code: 'c2', state: s2 });

    expect(reconnected.id).toBe(acc.id);
    expect(reconnected.displayName).toBe('Updated Name');

    const list = await service.listAccounts(userA);
    expect(list.length).toBe(1); // Still 1 account
  });

  it('handles health check, refreshes expired tokens, and reports provider errors', async () => {
    const { database, googleClient, service } = setupService();

    const { state } = await service.initiateConnect(userA);
    googleClient.exchangeResponses.set('c_health', {
      accessToken: 'access_health_1',
      refreshToken: 'refresh_health_1',
      expiresIn: 3600,
    });
    googleClient.userInfos.set('access_health_1', {
      id: 'g_health',
      email: 'health@gmail.com',
    });

    const acc = await service.completeCallback(userA, { code: 'c_health', state });

    // 1. Healthy check
    const health1 = await service.checkAccountHealth(userA, acc.id);
    expect(health1.healthy).toBe(true);
    expect(health1.status).toBe('connected');

    // 2. Token expired: automatic refresh check
    // Manually expire the token in DB
    const creds = await database.getAccountCredentials(userA.id, acc.id);
    await database.updateCredentials(
      acc.id,
      creds!.encryptedAccessToken,
      creds!.encryptedRefreshToken,
      new Date(Date.now() - 1000), // Expired 1s ago
    );

    const health2 = await service.checkAccountHealth(userA, acc.id);
    expect(health2.healthy).toBe(true);
    expect(health2.status).toBe('connected');

    // 3. Provider revokes refresh token: marks status as needs_reauth
    googleClient.refreshFails = true;
    await database.updateCredentials(
      acc.id,
      creds!.encryptedAccessToken,
      creds!.encryptedRefreshToken,
      new Date(Date.now() - 1000),
    );

    const health3 = await service.checkAccountHealth(userA, acc.id);
    expect(health3.healthy).toBe(false);
    expect(health3.status).toBe('needs_reauth');
    expect(health3.message).toContain('revoked');
  });

  it('disconnects account, revokes token at provider, and purges credentials', async () => {
    const { database, googleClient, service } = setupService();

    const { state } = await service.initiateConnect(userA);
    googleClient.exchangeResponses.set('c_disc', {
      accessToken: 'access_disc',
      refreshToken: 'refresh_disc',
      expiresIn: 3600,
    });
    googleClient.userInfos.set('access_disc', {
      id: 'g_disc',
      email: 'disconnect@gmail.com',
    });

    const acc = await service.completeCallback(userA, { code: 'c_disc', state });

    // Wrong email confirmation should fail
    await expect(
      service.disconnectAccount(userA, acc.id, { confirmEmail: 'wrong@gmail.com' }),
    ).rejects.toThrowError(MailError);

    // Disconnect with matching email
    const discResult = await service.disconnectAccount(userA, acc.id, {
      confirmEmail: 'disconnect@gmail.com',
    });
    expect(discResult.disconnected).toBe(true);

    // Verify token was revoked
    expect(googleClient.revokedTokens.has('refresh_disc')).toBe(true);

    // Verify credentials purged from DB
    const credsAfter = await database.getAccountCredentials(userA.id, acc.id);
    expect(credsAfter).toBeNull();

    // Verify status updated to disconnected
    const accDetail = await service.getAccount(userA, acc.id);
    expect(accDetail.status).toBe('disconnected');
  });

  it('enforces IDOR across user accounts', async () => {
    const { googleClient, service } = setupService();

    const { state } = await service.initiateConnect(userA);
    googleClient.exchangeResponses.set('c_idor', { accessToken: 't_idor', expiresIn: 3600 });
    googleClient.userInfos.set('t_idor', { id: 'g_idor', email: 'user.a.account@gmail.com' });
    const accA = await service.completeCallback(userA, { code: 'c_idor', state });

    // User B attempts to access User A's account details
    await expect(service.getAccount(userB, accA.id)).rejects.toThrowError(MailError);

    // User B attempts to check health of User A's account
    await expect(service.checkAccountHealth(userB, accA.id)).rejects.toThrowError(MailError);

    // User B attempts to disconnect User A's account
    await expect(service.disconnectAccount(userB, accA.id)).rejects.toThrowError(MailError);

    // User B attempts to update settings of User A's account
    await expect(
      service.updateSettings(userB, accA.id, { syncFrequencyMinutes: 60 }),
    ).rejects.toThrowError(MailError);
  });
});
