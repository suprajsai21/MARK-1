import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { PortalApi } from '../../../api.js';
import { PricingPage } from './PricingPage.js';

afterEach(() => cleanup());

describe('PricingPage', () => {
  it('loads the current price and updates it in integer paise', async () => {
    const api = {
      currentPrice: vi.fn().mockResolvedValue({ price: { productVersionId: 'mark1-v1', amountPaise: 19900, currency: 'INR', version: 2 } }),
      setCurrentPrice: vi.fn().mockResolvedValue({ productVersionId: 'mark1-v1', amountPaise: 25000, currency: 'INR', version: 3 }),
    } as unknown as PortalApi;
    render(<PricingPage api={api} />);

    expect(await screen.findByText(/Current price: ₹199\.00 INR/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Price in paise'), { target: { value: '25000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));

    await waitFor(() => expect(api.setCurrentPrice).toHaveBeenCalledWith({ productVersionId: 'mark1-v1', amountPaise: 25000 }));
    expect(await screen.findByText('Price updated.')).toBeTruthy();
  });

  it('refuses fractional or unsafe paise values before calling the API', async () => {
    const api = {
      currentPrice: vi.fn().mockResolvedValue({ price: null }),
      setCurrentPrice: vi.fn(),
    } as unknown as PortalApi;
    render(<PricingPage api={api} />);

    fireEvent.change(await screen.findByLabelText('Price in paise'), { target: { value: '1.5' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save price' }));
    expect(await screen.findByRole('alert')).toBeTruthy();
    expect(api.setCurrentPrice).not.toHaveBeenCalled();
  });
});
