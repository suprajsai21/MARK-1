import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { PortalApi } from '../../api.js';
import { CustomerPortal } from '../../portal.js';

afterEach(() => cleanup());

function apiFor(role: 'customer' | 'admin') {
  return {
    me: vi.fn().mockResolvedValue({ user: { id: 'u1', email: 'person@example.test', emailVerified: true, role } }),
    links: vi.fn().mockResolvedValue({ links: [] }),
    currentPrice: vi.fn().mockResolvedValue({ price: { productVersionId: 'mark1-v1', amountPaise: 19900, currency: 'INR', version: 1 } }),
    entitlements: vi.fn().mockResolvedValue({ entitlements: [] }),
    checkoutOrder: vi.fn().mockResolvedValue({ order: { orderId: 'order-1', amountPaise: '19900', currency: 'INR', productVersionId: 'mark1-v1', status: 'created' } }),
    setCurrentPrice: vi.fn(),
  } as unknown as PortalApi;
}

describe('customer portal payment routes', () => {
  it('renders checkout route for an authenticated customer and fetches current price', async () => {
    const api = apiFor('customer');
    render(<CustomerPortal api={api} route={{ pathname: '/checkout', search: '' }} />);
    expect(await screen.findByRole('heading', { name: 'MARK-1 access' })).toBeTruthy();
    expect(await screen.findByText('₹199.00 INR')).toBeTruthy();
    expect(api.currentPrice).toHaveBeenCalledOnce();
  });

  it('renders the order return route from API state', async () => {
    const api = apiFor('customer');
    render(<CustomerPortal api={api} route={{ pathname: '/payment/return', search: '?order_id=order-1&status=paid' }} />);
    expect(await screen.findByRole('heading', { name: 'Payment status' })).toBeTruthy();
    expect(await screen.findByText('Payment is processing. Access updates after the payment is verified.')).toBeTruthy();
    expect(api.checkoutOrder).toHaveBeenCalledWith('order-1');
    expect(api.currentPrice).not.toHaveBeenCalled();
  });

  it('renders admin pricing controls only for an admin', async () => {
    const adminApi = apiFor('admin');
    const { unmount } = render(<CustomerPortal api={adminApi} route={{ pathname: '/admin/pricing', search: '' }} />);
    expect(await screen.findByRole('heading', { name: 'MARK-1 pricing' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Save price' })).toBeTruthy();
    unmount();

    const customerApi = apiFor('customer');
    render(<CustomerPortal api={customerApi} route={{ pathname: '/admin/pricing', search: '' }} />);
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Save price' })).toBeNull();
    expect(customerApi.currentPrice).not.toHaveBeenCalled();
  });
});
