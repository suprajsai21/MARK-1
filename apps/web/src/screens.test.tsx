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
  oauthConsentInfo: vi.fn(),
  authorizeExtension: vi.fn(),
});

const consentSearch = new URLSearchParams({
  client_id: 'extension-client-test',
  redirect_uri: 'https://extension.invalid/oauth/callback',
  response_type: 'code',
  code_challenge: 'x'.repeat(43),
  code_challenge_method: 'S256',
  state: 'opaque-state',
}).toString();

const consentApi = () => ({
  ...anonymousApi(),
  me: vi.fn().mockResolvedValue({
    user: { id: 'customer-1', email: 'customer@example.test', emailVerified: true, role: 'customer' as const },
  }),
  links: vi.fn().mockResolvedValue({ links: [] }),
  oauthConsentInfo: vi.fn().mockResolvedValue({
    clientId: 'extension-client-test',
    redirectUri: 'https://extension.invalid/oauth/callback',
    consentRequired: true,
  }),
});

describe('extension authorization consent', () => {
  it('requires sign-in before displaying a consent action', async () => {
    const api = {
      ...anonymousApi(),
      oauthConsentInfo: vi.fn().mockResolvedValue({
        clientId: 'extension-client-test',
        redirectUri: 'https://extension.invalid/oauth/callback',
        consentRequired: true,
      }),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/oauth/authorize', search: `?${consentSearch}` }} />);

    expect(await screen.findByLabelText('Email')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull();
    expect(api.authorizeExtension).not.toHaveBeenCalled();
  });

  it('resumes the same authorization request after the customer signs in', async () => {
    const user = { id: 'customer-1', email: 'customer@example.test', emailVerified: true, role: 'customer' as const };
    const api = {
      ...anonymousApi(),
      login: vi.fn().mockResolvedValue({ user }),
      links: vi.fn().mockResolvedValue({ links: [] }),
      oauthConsentInfo: vi.fn().mockResolvedValue({
        clientId: 'extension-client-test',
        redirectUri: 'https://extension.invalid/oauth/callback',
        consentRequired: true,
      }),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/oauth/authorize', search: `?${consentSearch}` }} />);

    fireEvent.change(await screen.findByLabelText('Email'), { target: { value: 'customer@example.test' } });
    fireEvent.change(screen.getByLabelText('Password'), { target: { value: 'correct horse battery' } });
    fireEvent.click(screen.getByRole('button', { name: 'Sign in' }));

    expect(await screen.findByRole('heading', { name: 'Authorize extension' })).toBeTruthy();
    expect(screen.getByText('https://extension.invalid/oauth/callback')).toBeTruthy();
    expect(api.oauthConsentInfo).toHaveBeenCalledWith(expect.objectContaining({
      clientId: 'extension-client-test',
      redirectUri: 'https://extension.invalid/oauth/callback',
    }));
    expect(api.authorizeExtension).not.toHaveBeenCalled();
  });

  it('shows the server-validated destination and authorizes nothing on load', async () => {
    const api = consentApi() as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/oauth/authorize', search: `?${consentSearch}` }} />);

    expect(await screen.findByRole('heading', { name: 'Authorize extension' })).toBeTruthy();
    expect(screen.getByText('https://extension.invalid/oauth/callback')).toBeTruthy();
    expect(api.oauthConsentInfo).toHaveBeenCalledWith(expect.objectContaining({ clientId: 'extension-client-test' }));
    expect(api.authorizeExtension).not.toHaveBeenCalled();
  });

  it('submits explicit consent and follows the returned redirect', async () => {
    const api = {
      ...consentApi(),
      authorizeExtension: vi.fn().mockResolvedValue({
        redirectUrl: 'https://extension.invalid/oauth/callback?code=opaque-code&state=opaque-state',
      }),
    } as unknown as PortalApi;
    const navigate = vi.fn();
    render(
      <CustomerPortal
        api={api}
        route={{ pathname: '/oauth/authorize', search: `?${consentSearch}` }}
        navigate={navigate}
      />,
    );

    fireEvent.click(await screen.findByRole('button', { name: 'Authorize' }));

    await waitFor(() => expect(api.authorizeExtension).toHaveBeenCalledWith({
      clientId: 'extension-client-test',
      redirectUri: 'https://extension.invalid/oauth/callback',
      codeChallenge: 'x'.repeat(43),
      state: 'opaque-state',
    }));
    await waitFor(() => expect(navigate).toHaveBeenCalledWith(
      'https://extension.invalid/oauth/callback?code=opaque-code&state=opaque-state',
    ));
  });

  it('refuses to show consent when the extension request is rejected', async () => {
    const api = {
      ...consentApi(),
      oauthConsentInfo: vi.fn().mockRejectedValue(new Error('invalid client')),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/oauth/authorize', search: `?${consentSearch}` }} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Authorize' })).toBeNull();
  });

  it('refuses to render consent for an incomplete authorization request', async () => {
    const api = { ...consentApi() } as unknown as PortalApi;
    render(<CustomerPortal api={api} route={{ pathname: '/oauth/authorize', search: '?client_id=only' }} />);

    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.oauthConsentInfo).not.toHaveBeenCalled();
  });
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
  it('uses the server-authoritative pricing, checkout, and entitlement endpoints', async () => {
    const responses = [
      { price: { productVersionId: 'mark1-v1', amountPaise: 19900, currency: 'INR', version: 2 } },
      { orderId: 'order-1', amountPaise: '19900', currency: 'INR', razorpayOrderId: 'rzp-order-1', checkoutKeyId: 'rzp_public' },
      { order: { orderId: 'order-1', amountPaise: '19900', currency: 'INR', status: 'paid' } },
      { entitlements: [{ productVersionId: 'mark1-v1', status: 'active' }] },
      { productVersionId: 'mark1-v1', amountPaise: 25000, currency: 'INR', version: 3 },
    ];
    const fetcher = vi.fn().mockImplementation(async () => ({ ok: true, json: async () => responses.shift() }));
    const api = new PortalApi('', fetcher);

    await api.currentPrice();
    await api.createCheckoutOrder();
    await api.checkoutOrder('order-1');
    await api.entitlements();
    await api.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise: 25000 });

    expect(fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body])).toEqual([
      ['/v1/pricing/current', undefined, undefined],
      ['/v1/checkout/orders', 'POST', '{}'],
      ['/v1/checkout/orders/order-1', undefined, undefined],
      ['/v1/entitlement', undefined, undefined],
      ['/v1/admin/pricing/current', 'PUT', JSON.stringify({ productVersionId: 'mark1-v1', amountPaise: 25000 })],
    ]);
  });

  it('posts credentials, single-use tokens, and explicit OAuth consent to the auth endpoints', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true, redirectUrl: 'https://extension.invalid/callback' }) });
    const api = new PortalApi('', fetcher);

    await api.verifyEmail('opaque-token');
    await api.resendVerification('user@example.test');
    await api.requestPasswordReset('user@example.test');
    await api.resetPassword('opaque-reset', 'correct horse battery');
    await api.authorizeExtension({
      clientId: 'extension-client-test',
      redirectUri: 'https://extension.invalid/oauth/callback',
      codeChallenge: 'x'.repeat(43),
      state: 'opaque-state',
    });

    const calls = fetcher.mock.calls.map(([url, init]) => [url, init.method, init.body]);
    expect(calls.slice(0, 4)).toEqual([
      ['/v1/auth/verify-email', 'POST', JSON.stringify({ token: 'opaque-token' })],
      ['/v1/auth/verify-email/resend', 'POST', JSON.stringify({ email: 'user@example.test' })],
      ['/v1/auth/password/reset/request', 'POST', JSON.stringify({ email: 'user@example.test' })],
      ['/v1/auth/password/reset/complete', 'POST', JSON.stringify({ token: 'opaque-reset', newPassword: 'correct horse battery' })],
    ]);
    expect(calls[4]?.[0]).toBe('/v1/oauth/authorize');
    expect(calls[4]?.[1]).toBe('POST');
    expect(JSON.parse(calls[4]?.[2] as string)).toEqual({
      clientId: 'extension-client-test',
      redirectUri: 'https://extension.invalid/oauth/callback',
      codeChallenge: 'x'.repeat(43),
      consented: true,
      state: 'opaque-state',
    });
  });
});
