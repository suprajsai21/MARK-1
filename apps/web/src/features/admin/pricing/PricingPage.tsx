import { useEffect, useState } from 'react';
import type { PortalApi, PriceSnapshot } from '../../../api.js';
import { PriceForm } from './PriceForm.js';

export function PricingPage({ api }: { api: PortalApi }) {
  const [price, setPrice] = useState<PriceSnapshot | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api.currentPrice().then(({ price: current }) => {
      if (active) setPrice(current);
    }).catch((cause: unknown) => {
      if (active) setError(cause instanceof Error ? cause.message : 'Could not load the current price.');
    }).finally(() => { if (active) setLoaded(true); });
    return () => { active = false; };
  }, [api]);

  return (
    <section aria-labelledby="pricing-heading">
      <h2 id="pricing-heading">MARK-1 pricing</h2>
      <p>Set the one-time INR price. The API applies this price to new orders only.</p>
      {error && <p role="alert">{error}</p>}
      {!loaded ? <p role="status">Loading current price…</p> : price ? (
        <p>Current price: ₹{(price.amountPaise / 100).toFixed(2)} INR · version {price.version}</p>
      ) : <p>No current price is configured.</p>}
      <PriceForm key={price?.version ?? 'new'} api={api} initialAmountPaise={price?.amountPaise ?? ''} />
    </section>
  );
}
