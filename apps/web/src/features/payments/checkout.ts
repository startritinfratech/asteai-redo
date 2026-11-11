/**
 * Razorpay Checkout in the browser.
 *
 * loadRazorpayCheckout() injects https://checkout.razorpay.com/v1/checkout.js once.
 * openCheckout() opens the payment modal for an order the API created and settles when the
 * buyer pays or closes it. payWithRazorpay() does both and then reports the payment to the
 * API (POST /payments/razorpay/verify). That call only makes the page update at once: the
 * Razorpay webhook captures the payment on the server even if the browser closes first.
 */
import { paymentsApi } from './api';
import type { FundMilestoneCheckout } from './types';

const SCRIPT_SRC = 'https://checkout.razorpay.com/v1/checkout.js';

interface RazorpaySuccess {
  razorpay_order_id: string;
  razorpay_payment_id: string;
  razorpay_signature: string;
}

interface RazorpayFailure {
  error?: { description?: string; reason?: string };
}

interface RazorpayInstance {
  open(): void;
  on(event: 'payment.failed', cb: (res: RazorpayFailure) => void): void;
}

type RazorpayConstructor = new (options: Record<string, unknown>) => RazorpayInstance;

declare global {
  interface Window { Razorpay?: RazorpayConstructor }
}

let loading: Promise<RazorpayConstructor> | null = null;

/** Loads checkout.js once (a failed load is retried on the next call). */
export function loadRazorpayCheckout(): Promise<RazorpayConstructor> {
  if (typeof window === 'undefined') return Promise.reject(new Error('Checkout runs in the browser'));
  if (window.Razorpay) return Promise.resolve(window.Razorpay);
  if (!loading) {
    loading = new Promise<RazorpayConstructor>((resolve, reject) => {
      const existing = document.querySelector<HTMLScriptElement>(`script[src="${SCRIPT_SRC}"]`);
      const script = existing ?? document.createElement('script');
      const fail = () => {
        loading = null;
        script.remove();
        reject(new Error(PAYMENT_MESSAGES.loadFailed));
      };
      script.addEventListener('load', () => (window.Razorpay ? resolve(window.Razorpay) : fail()), { once: true });
      script.addEventListener('error', fail, { once: true });
      if (!existing) {
        script.src = SCRIPT_SRC;
        script.async = true;
        document.body.appendChild(script);
      }
    });
  }
  return loading;
}

export interface CheckoutDetails {
  orderId: string;
  /** Minor units (paise), exactly as the API's order. */
  amount: number;
  currency: string;
  keyId: string;
  name: string;
  description: string;
  prefill?: { name?: string; email?: string };
}

export type CheckoutResult =
  | { kind: 'paid'; orderId: string; paymentId: string; signature: string }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string };

/** The options object Razorpay Checkout takes (without the callbacks). */
export function checkoutOptions(d: CheckoutDetails): Record<string, unknown> {
  return {
    key: d.keyId,
    order_id: d.orderId,
    amount: d.amount,
    currency: d.currency,
    name: d.name,
    description: d.description.slice(0, 255),
    prefill: { name: d.prefill?.name ?? '', email: d.prefill?.email ?? '' },
    theme: { color: '#2f6fe8' },
  };
}

/**
 * Opens the Razorpay modal. A failed attempt keeps the modal open (Razorpay lets the buyer
 * try another method), so a failure is only reported if the buyer then closes it.
 */
export async function openCheckout(d: CheckoutDetails): Promise<CheckoutResult> {
  const Razorpay = await loadRazorpayCheckout();
  return new Promise<CheckoutResult>((resolve) => {
    let lastError: string | null = null;
    let settled = false;
    const settle = (r: CheckoutResult) => { if (!settled) { settled = true; resolve(r); } };
    const rzp = new Razorpay({
      ...checkoutOptions(d),
      handler: (res: RazorpaySuccess) => settle({
        kind: 'paid', orderId: res.razorpay_order_id, paymentId: res.razorpay_payment_id, signature: res.razorpay_signature,
      }),
      modal: {
        ondismiss: () => settle(lastError ? { kind: 'failed', message: lastError } : { kind: 'dismissed' }),
      },
    });
    rzp.on('payment.failed', (res) => {
      lastError = res.error?.description || 'The payment did not go through';
    });
    rzp.open();
  });
}

/**
 * `captured`: the API confirmed the payment. `pending`: Razorpay took the payment but the
 * API has not confirmed it yet (the webhook will). `dismissed` / `failed`: nothing was paid.
 */
export type PaymentOutcome =
  | { kind: 'captured' }
  | { kind: 'pending' }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string };

export const PAYMENT_MESSAGES = {
  captured: 'Payment received.',
  pending: 'Payment pending — we’ll update this page when the bank confirms.',
  dismissed: 'Payment cancelled. Nothing was charged; you can pay whenever you are ready.',
  failed: (message: string) => `Payment failed: ${message}. Nothing was charged; you can try again.`,
  loadFailed: 'Could not load the Razorpay checkout. Check your connection (or ad blocker) and try again.',
} as const;

export async function payWithRazorpay(
  checkout: FundMilestoneCheckout,
  details: { name: string; description: string; prefill?: CheckoutDetails['prefill'] },
): Promise<PaymentOutcome> {
  const result = await openCheckout({
    orderId: checkout.orderId, amount: checkout.amountMinor, currency: checkout.currency, keyId: checkout.keyId, ...details,
  });
  if (result.kind !== 'paid') return result;
  try {
    await paymentsApi.verifyRazorpay({ orderId: result.orderId, paymentId: result.paymentId, signature: result.signature });
    return { kind: 'captured' };
  } catch {
    // Paid at Razorpay, but our confirmation did not go through; the webhook will capture it.
    return { kind: 'pending' };
  }
}
