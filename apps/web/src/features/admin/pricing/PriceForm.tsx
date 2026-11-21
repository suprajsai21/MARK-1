import { useState } from 'react';
import type { PortalApi } from '../../../api.js';

type Notice = { tone: 'error' | 'info'; text: string } | null;

export function PriceForm({ api, initialAmountPaise = '' }: {
  api: PortalApi;
  initialAmountPaise?: number | '';
}) {
  const [amount, setAmount] = useState(String(initialAmountPaise));
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const amountPaise = Number(amount);
    if (!/^\d+$/.test(amount) || !Number.isSafeInteger(amountPaise) || amountPaise <= 0) {
      setNotice({ tone: 'error', text: 'Enter a positive whole-number amount in paise.' });
      return;
    }
    setBusy(true);
    setNotice(null);
    try {
      await api.setCurrentPrice({ productVersionId: 'mark1-v1', amountPaise });
      setNotice({ tone: 'info', text: 'Price updated.' });
    } catch (error) {
      setNotice({ tone: 'error', text: error instanceof Error ? error.message : 'Could not update price.' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(event) => { void save(event); }} aria-label="Set MARK-1 price">
      <label htmlFor="price-paise">Price in paise</label>
      <input id="price-paise" type="text" inputMode="numeric" value={amount} onChange={(event) => setAmount(event.target.value)} />
      <p>Amounts are INR paise. The initial one-time price is ₹49.00 (4900 paise).</p>
      <button type="submit" disabled={busy}>Save price</button>
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    </form>
  );
}
