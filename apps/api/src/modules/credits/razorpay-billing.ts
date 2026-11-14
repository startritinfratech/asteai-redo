import { PaymentProviderError, RazorpayProvider, type ProviderOrder } from '../payments/payment-provider';

/**
 * The two Razorpay calls credits need: an order (top-up) and a subscription (Pro).
 * Orders reuse the payments module's client; subscriptions are one more POST in the same
 * style (no retry: creating either is not idempotent at Razorpay).
 */
export interface BillingProvider {
  createOrder(input: { amountMinor: number; receipt: string; notes: Record<string, string> }): Promise<ProviderOrder>;
  createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }): Promise<{ id: string; status: string }>;
}

export const BILLING_PROVIDER = 'CREDITS_BILLING_PROVIDER';
export const BILLING_CONFIG = 'CREDITS_BILLING_CONFIG';

export interface BillingConfig {
  keyId?: string;
  keySecret?: string;
  /** Secret of the webhook pointed at /credits/razorpay/webhook. */
  webhookSecret?: string;
  /** Razorpay plan for Pro (₹499/month) when plans.razorpay_plan_id is not set. */
  proPlanId?: string;
}

const RAZORPAY_API = 'https://api.razorpay.com/v1';

export class RazorpayBillingProvider implements BillingProvider {
  private readonly orders: RazorpayProvider;
  private readonly auth: string;

  constructor(keyId: string, keySecret: string, private readonly http: typeof fetch = fetch) {
    this.orders = new RazorpayProvider(keyId, keySecret, http);
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  createOrder(input: { amountMinor: number; receipt: string; notes: Record<string, string> }) {
    return this.orders.createOrder({ ...input, currency: 'INR' });
  }

  async createSubscription(input: { planId: string; totalCount: number; notes: Record<string, string> }) {
    let res: Response;
    try {
      res = await this.http(`${RAZORPAY_API}/subscriptions`, {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan_id: input.planId, total_count: input.totalCount, quantity: 1, customer_notify: 1, notes: input.notes,
        }),
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new PaymentProviderError('Razorpay could not be reached', 'unavailable');
    }
    const json = (await res.json().catch(() => null)) as { id?: unknown; status?: unknown; error?: { description?: string } } | null;
    if (!res.ok) {
      const desc = json?.error?.description;
      throw new PaymentProviderError(
        `Razorpay ${res.status}${desc ? `: ${desc.slice(0, 200)}` : ''}`, res.status >= 500 ? 'unavailable' : 'rejected', res.status,
      );
    }
    if (typeof json?.id !== 'string') throw new PaymentProviderError('Razorpay returned an unexpected response', 'unavailable');
    return { id: json.id, status: String(json.status ?? 'created') };
  }
}
