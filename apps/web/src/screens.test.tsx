import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalApi } from './api.js';
import { CustomerPortal } from './portal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

// A factory, not a shared object: restoreAllMocks clears mock implementations,
// so a module-scope stub would hand later tests undefined-returning methods.
const anonymousApi = () => ({
  me: vi.fn().mockRejectedValue(new Error('Not signed in')),
  login: vi.fn(),
  register: vi.fn(),
  logout: vi.fn(),
  links: vi.fn(),
  verifyEmail: vi.fn(),
  resendVerification: vi.fn(),
  requestPasswordReset: vi.fn(),
  resetPassword: vi.fn(),
});

describe('email verification screen', () => {
  it('does not consume the one-use token until the customer confirms', async () => {
    const api = { ...anonymousApi(), verifyEmail: vi.fn().mockResolvedValue({ verified: true }) } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/verify-email', search: '?token=opaque-token' }} />);

    // An email scanner fetching the link must not burn the single-use token.
    expect(api.verifyEmail).not.toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Verify email' }));

    await waitFor(() => expect(api.verifyEmail).toHaveBeenCalledWith('opaque-token'));
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('reports an expired or already-used verification link', async () => {
    const api = {
      ...anonymousApi(),
      verifyEmail: vi.fn().mockRejectedValue(new Error('Verification link is invalid or expired')),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/verify-email', search: '?token=stale' }} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Verify email' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toContain('Verification link is invalid or expired');
  });

  it('refuses to show a verification screen without a token', async () => {
    const api = { ...anonymousApi() } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/verify-email', search: '' }} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Verify email' })).toBeNull();
  });
});

describe('password recovery screens', () => {
  it('requests a reset without revealing whether the address exists', async () => {
    const api = {
      ...anonymousApi(),
      me: vi.fn().mockRejectedValue(new Error('Not signed in')),
      requestPasswordReset: vi.fn().mockResolvedValue({ accepted: true }),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} />);

    fireEvent.click(await screen.findByRole('button', { name: 'Forgot password?' }));
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: ' Customer@Example.Test ' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send reset link' }));

    await waitFor(() => expect(api.requestPasswordReset).toHaveBeenCalledWith('Customer@Example.Test'));
    expect((await screen.findByRole('status')).textContent).toContain(
      'If that address has an account, a reset link is on its way.',
    );
  });

  it('submits a new password with the emailed token', async () => {
    const api = {
      ...anonymousApi(),
      resetPassword: vi.fn().mockResolvedValue({ changed: true }),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/password/reset', search: '?token=opaque-reset' }} />);

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    await waitFor(() => expect(api.resetPassword).toHaveBeenCalledWith('opaque-reset', 'correct horse battery'));
    expect(await screen.findByRole('link', { name: 'Sign in' })).toBeTruthy();
  });

  it('does not submit when the two passwords differ', async () => {
    const api = { ...anonymousApi(), resetPassword: vi.fn() } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/password/reset', search: '?token=opaque-reset' }} />);

    fireEvent.change(await screen.findByLabelText('New password'), { target: { value: 'correct horse battery' } });
    fireEvent.change(screen.getByLabelText('Confirm new password'), { target: { value: 'something else entirely' } });
    fireEvent.click(screen.getByRole('button', { name: 'Set new password' }));

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.resetPassword).not.toHaveBeenCalled();
  });

  it('refuses to show the reset form without a token', async () => {
    const api = { ...anonymousApi() } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/password/reset', search: '' }} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByLabelText('New password')).toBeNull();
  });
});

describe('account API helpers', () => {
  it('posts credentials and single-use tokens to the auth endpoints', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });
    const api = new PortalApi('', fetcher);

    await api.verifyEmail('opaque-token');
    await api.resendVerification('user@example.test');
    await api.requestPasswordReset('user@example.test');
    await api.resetPassword('opaque-reset', 'correct horse battery');

    const calls = fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body]);
    expect(calls).toEqual([
      ['/v1/auth/verify-email', 'POST', JSON.stringify({ token: 'opaque-token' })],
      ['/v1/auth/verify-email/resend', 'POST', JSON.stringify({ email: 'user@example.test' })],
      ['/v1/auth/password/reset/request', 'POST', JSON.stringify({ email: 'user@example.test' })],
      ['/v1/auth/password/reset/complete', 'POST', JSON.stringify({ token: 'opaque-reset', newPassword: 'correct horse battery' })],
    ]);
  });
});
