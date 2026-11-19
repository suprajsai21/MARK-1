import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PortalApi } from '../../api.js';
import { CheckoutPage } from './CheckoutPage.js';

afterEach(() => cleanup());

const apiWith = (overrides: Record<string, unknown> = {}) => ({
  currentPrice: vi.fn().mockResolvedValue({ price: { productVersionId: 'mark1-v1', amountPaise: 19900, currency: 'INR', version: 1 } }),
  entitlements: vi.fn().mockResolvedValue({ entitlements: [] }),
  createCheckoutOrder: vi.fn().mockResolvedValue({ orderId: 'order-1', amountPaise: '19900', currency: 'INR', productVersionId: 'mark1-v1', razorpayOrderId: 'rzp-order-1', checkoutKeyId: 'rzp_public' }),
  checkoutOrder: vi.fn().mockResolvedValue({ order: { orderId: 'order-1', amountPaise: '19900', currency: 'INR', productVersionId: 'mark1-v1', status: 'created' } }),
  ...overrides,
}) as unknown as PortalApi;

describe('CheckoutPage', () => {
  it('launches provider checkout with server-created order details and never grants from callback data', async () => {
    const api = apiWith();
    let options: Record<string, unknown> | undefined;
    const instances: Array<{ open: ReturnType<typeof vi.fn> }> = [];
    class MockRazorpay {
      open = vi.fn();
      constructor(input: Record<string, unknown>) {
        options = input;
        instances.push(this);
      }
    }
    Object.defineProperty(window, 'Razorpay', { configurable: true, value: MockRazorpay });
    render(<CheckoutPage api={api} />);

    expect(await screen.findByText('₹199.00 INR')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));

    expect(await screen.findByText('Payment is processing. Access updates after the payment is verified.')).toBeTruthy();
    expect(api.createCheckoutOrder).toHaveBeenCalledOnce();
    expect(options).toMatchObject({ key: 'rzp_public', amount: 19900, currency: 'INR', order_id: 'rzp-order-1' });
    expect(instances).toHaveLength(1);
    expect(instances[0]?.open).toHaveBeenCalledOnce();
    const handler = options?.handler as (claim: Record<string, string>) => void;
    handler({ razorpay_payment_id: 'untrusted-payment', razorpay_signature: 'untrusted-signature' });
    expect(window.location.href).not.toContain('untrusted-payment');
    expect(window.location.href).not.toContain('untrusted-signature');
  });

  it('does not invoke provider when checkout SDK is unavailable', async () => {
    const api = apiWith();
    delete (window as Window & { Razorpay?: unknown }).Razorpay;
    render(<CheckoutPage api={api} />);
    expect(await screen.findByText('₹199.00 INR')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Continue to payment' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.createCheckoutOrder).not.toHaveBeenCalled();
    expect(api.checkoutOrder).not.toHaveBeenCalled();
    expect(screen.queryByText('Payment is processing. Access updates after the payment is verified.')).toBeNull();
  });

  it('checks entitlement for the purchased product version, not a hardcoded version', async () => {
    const api = apiWith({
      checkoutOrder: vi.fn().mockResolvedValue({ order: { orderId: 'order-2', amountPaise: '19900', currency: 'INR', status: 'paid', productVersionId: 'mark1-v2' } }),
      entitlements: vi.fn().mockResolvedValue({ entitlements: [{ productVersionId: 'mark1-v2', status: 'active' }] }),
    });
    render(<CheckoutPage api={api} initialOrderId="order-2" />);
    expect(await screen.findByText('Access active')).toBeTruthy();
  });

  it('shows payment return status from the API, never from URL claims', async () => {
    const api = apiWith({
      checkoutOrder: vi.fn().mockResolvedValue({ order: { orderId: 'order-1', amountPaise: '19900', currency: 'INR', productVersionId: 'mark1-v1', status: 'paid' } }),
      entitlements: vi.fn().mockResolvedValue({ entitlements: [{ productVersionId: 'mark1-v1', status: 'active' }] }),
    });
    render(<CheckoutPage api={api} initialOrderId="order-1" />);

    expect(await screen.findByText('Access active')).toBeTruthy();
    expect(api.checkoutOrder).toHaveBeenCalledWith('order-1');
    expect(api.entitlements).toHaveBeenCalled();
    expect(api.createCheckoutOrder).not.toHaveBeenCalled();
  });

  it('refreshes status only from the API and handles unavailable pricing', async () => {
    const api = apiWith({ currentPrice: vi.fn().mockResolvedValue({ price: null }) });
    render(<CheckoutPage api={api} />);
    expect(await screen.findByText('Checkout is currently unavailable.')).toBeTruthy();
    await waitFor(() => expect(api.createCheckoutOrder).not.toHaveBeenCalled());
  });
});
