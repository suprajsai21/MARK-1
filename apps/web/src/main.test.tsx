import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { PortalApi } from './api.js';
import { CustomerPortal } from './portal.js';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('customer portal', () => {
  it('shows sign in and registration options when no session exists', async () => {
    const api = {
      me: vi.fn().mockRejectedValue(new Error('Not signed in')),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      links: vi.fn(),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} />);
    expect(await screen.findByRole('heading', { name: 'Your account' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign in' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Create account' })).toBeTruthy();
  });

  it('loads linked integrations for an authenticated customer and supports logout', async () => {
    const api = {
      me: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'user@example.test', emailVerified: true, role: 'customer' } }),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn().mockResolvedValue({ loggedOut: true }),
      links: vi.fn().mockResolvedValue({ links: [{ linkId: 'l1', integrationId: 'integration-one' }] }),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} />);
    expect(await screen.findByText('integration-one')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Sign out' }));
    await waitFor(() => expect(api.logout).toHaveBeenCalledOnce());
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeTruthy();
  });

  it('shows an error when linked integrations cannot be loaded', async () => {
    const api = {
      me: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'user@example.test', emailVerified: true, role: 'customer' } }),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn(),
      links: vi.fn().mockRejectedValue(new Error('Service unavailable')),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByText('No integrations are linked to this account.')).toBeNull();
  });

  it('retains the authenticated session and reports logout failures', async () => {
    const api = {
      me: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'user@example.test', emailVerified: true, role: 'customer' } }),
      login: vi.fn(),
      register: vi.fn(),
      logout: vi.fn().mockRejectedValue(new Error('Service unavailable')),
      links: vi.fn().mockResolvedValue({ links: [] }),
    } as unknown as PortalApi;
    render(<CustomerPortal api={api} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Sign out' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Sign out' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Sign in' })).toBeNull();
  });

  it('sends same-origin JSON with cookie credentials for state-changing requests', async () => {
    const fetcher = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ loggedOut: true }) });
    const api = new PortalApi('', fetcher);
    await api.logout();
    expect(fetcher).toHaveBeenCalledWith('/v1/auth/logout', expect.objectContaining({
      credentials: 'include',
      method: 'POST',
      body: '{}',
    }));
  });
});
