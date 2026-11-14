/**
 * Buying credits in the browser. The API creates the Razorpay order (top-up) or
 * subscription (Pro), Razorpay Checkout takes the payment in its own modal (allowed by our
 * CSP: script from checkout.razorpay.com, frames from api.razorpay.com), and the API's
 * webhook credits the wallet. The checkout callback below only makes the page update at once.
 */
import { openCheckout, PAYMENT_MESSAGES, type CheckoutDetails } from '@/features/payments';
import { creditsApi } from './api';

type Prefill = CheckoutDetails['prefill'];

export type PurchaseOutcome =
  /** Credits are in the wallet. */
  | { kind: 'credited'; credits: number; balance: number }
  /** Paid; the wallet updates when the webhook lands (seconds, usually). */
  | { kind: 'pending' }
  | { kind: 'dismissed' }
  | { kind: 'failed'; message: string };

export async function buyCreditPack(packId: string, prefill?: Prefill): Promise<PurchaseOutcome> {
  const order = await creditsApi.createTopup(packId);
  const result = await openCheckout({
    orderId: order.orderId,
    amount: order.amountMinor,
    currency: order.currency,
    keyId: order.keyId,
    name: 'AsteAI credits',
    description: `${order.credits} AI credits`,
    prefill,
  });
  if (result.kind !== 'paid') return result;
  try {
    const verified = await creditsApi.verifyTopup({
      orderId: result.orderId ?? order.orderId, paymentId: result.paymentId, signature: result.signature,
    });
    if (verified.status !== 'credited') return { kind: 'pending' };
    return { kind: 'credited', credits: order.credits, balance: verified.wallet.balance };
  } catch {
    return { kind: 'pending' };
  }
}

export type SubscribeOutcome = { kind: 'activating' } | { kind: 'dismissed' } | { kind: 'failed'; message: string };

/** Pro is switched on by the `subscription.charged` webhook, so success here means "activating". */
export async function subscribeToPro(prefill?: Prefill): Promise<SubscribeOutcome> {
  const sub = await creditsApi.subscribePro();
  const result = await openCheckout({
    subscriptionId: sub.subscriptionId,
    keyId: sub.keyId,
    name: 'AsteAI Pro',
    description: 'Pro plan · 100 AI credits every month',
    prefill,
  });
  return result.kind === 'paid' ? { kind: 'activating' } : result;
}

export const PURCHASE_MESSAGES = {
  credited: (credits: number) => `${credits.toLocaleString('en-IN')} credits added to your wallet.`,
  pending: 'Payment received. Your credits will appear here as soon as Razorpay confirms it.',
  activating: 'Payment received. Pro switches on as soon as Razorpay confirms the first charge.',
  dismissed: PAYMENT_MESSAGES.dismissed,
  failed: PAYMENT_MESSAGES.failed,
} as const;
