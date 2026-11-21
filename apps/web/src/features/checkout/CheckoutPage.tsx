import { useEffect, useState } from 'react';
import type { CheckoutOrder, PortalApi, PriceSnapshot } from '../../api.js';

type Notice = { tone: 'error' | 'info'; text: string } | null;

type RazorpayOptions = {
  key: string;
  amount: number;
  currency: 'INR';
  order_id: string;
  handler: (claim: Record<string, string>) => void;
  modal?: { ondismiss: () => void };
};

type RazorpayConstructor = new (options: RazorpayOptions) => { open: () => void };

declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

export function CheckoutPage({ api, initialOrderId }: { api: PortalApi; initialOrderId?: string | null }) {
  const [price, setPrice] = useState<PriceSnapshot | null>(null);
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [loadingPrice, setLoadingPrice] = useState(!initialOrderId);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);

  useEffect(() => {
    let active = true;
    if (!initialOrderId) {
      void api.currentPrice().then(({ price: current }) => {
        if (active) setPrice(current);
      }).catch((error: unknown) => {
        if (active) setNotice({ tone: 'error', text: message(error, 'Could not load checkout. Try again shortly.') });
      }).finally(() => { if (active) setLoadingPrice(false); });
    }
    return () => { active = false; };
  }, [api, initialOrderId]);

  const beginCheckout = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const Razorpay = window.Razorpay;
      if (!Razorpay) throw new Error('Payment checkout could not be loaded. Refresh and try again.');
      const created = await api.createCheckoutOrder();
      if (created.currency !== 'INR' || !Number.isSafeInteger(Number(created.amountPaise)) ||
        Number(created.amountPaise) <= 0 || !created.checkoutKeyId || !created.razorpayOrderId) {
        throw new Error('The payment provider returned invalid checkout details.');
      }

      // Provider callbacks are intentionally ignored; only verified server state can grant access.
      const checkout = new Razorpay({
        key: created.checkoutKeyId,
        amount: Number(created.amountPaise),
        currency: created.currency,
        order_id: created.razorpayOrderId,
        // Treat provider completion only as a reason to revisit API-owned status.
        handler: () => {
          window.location.assign(`/payment/return?order_id=${encodeURIComponent(created.orderId)}`);
        },
        modal: {
          ondismiss: () => {
            setOrder({ orderId: created.orderId, amountPaise: created.amountPaise, currency: created.currency, productVersionId: created.productVersionId, status: 'created' });
          },
        },
      });
      checkout.open();
      setOrder({ orderId: created.orderId, amountPaise: created.amountPaise, currency: created.currency, productVersionId: created.productVersionId, status: 'created' });
    } catch (error) {
      setNotice({ tone: 'error', text: message(error, 'Could not start checkout. Try again shortly.') });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="checkout-heading">
      <h2 id="checkout-heading">MARK-1 access</h2>
      {initialOrderId ? (
        <PaymentStatusPage key={initialOrderId} api={api} orderId={initialOrderId} />
      ) : order ? (
        <PaymentStatusPage key={order.orderId} api={api} orderId={order.orderId} />
      ) : price ? (
        price.currency === 'INR' && Number.isSafeInteger(price.amountPaise) && price.amountPaise > 0 ? (
          <>
            <p>One-time purchase · continuing access to {price.productVersionId}</p>
            <p>{formatPaise(price.amountPaise)} INR</p>
            <button type="button" onClick={() => { void beginCheckout(); }} disabled={busy}>Continue to payment</button>
          </>
        ) : <p role="alert">Checkout is currently unavailable.</p>
      ) : loadingPrice ? <p role="status">Loading current price…</p> : <p>Checkout is currently unavailable.</p>}
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    </section>
  );
}

export function PaymentStatusPage({ api, orderId }: { api: PortalApi; orderId: string }) {
  const [order, setOrder] = useState<CheckoutOrder | null>(null);
  const [entitlementActive, setEntitlementActive] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const { order: current } = await api.checkoutOrder(orderId);
      const { entitlements } = await api.entitlements();
      setOrder(current);
      setEntitlementActive(current.status === 'paid' && entitlements.some((item) =>
        item.productVersionId === current.productVersionId && item.status === 'active'));
    } catch (error) {
      setNotice({ tone: 'error', text: message(error, 'Could not verify payment status.') });
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => { void refresh(); }, [api, orderId]);

  return (
    <div aria-label="Payment status">
      <h3>Payment status</h3>
      {order ? <p>Order: {order.status.replaceAll('_', ' ')}</p> : !notice ? <p role="status">Checking your order…</p> : null}
      {entitlementActive ? <p role="status">Access active</p> : order && <p role="status">{statusMessage(order.status)}</p>}
      <button type="button" onClick={() => { void refresh(); }} disabled={busy}>Refresh payment status</button>
      {notice && <p role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</p>}
    </div>
  );
}

function statusMessage(status: CheckoutOrder['status']): string {
  if (status === 'failed') return 'Payment was not completed. You can try again.';
  if (status === 'refunded' || status === 'charged_back') return 'Access is not active for this purchase.';
  return 'Payment is processing. Access updates after the payment is verified.';
}

function formatPaise(amountPaise: number): string {
  return `₹${(amountPaise / 100).toFixed(2)}`;
}

function message(error: unknown, fallback: string): string {
  return error instanceof Error && error.message && error.message !== 'Request failed' ? error.message : fallback;
}
