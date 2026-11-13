/**
 * The payment provider behind PaymentsService. Production uses Razorpay's REST API
 * (RazorpayProvider); tests pass a fake.
 *
 * Neither call is retried here: creating an order or a refund is not idempotent at
 * Razorpay, so a retry after a timeout could charge or refund twice (AUDIT-14). Callers
 * decide what an uncertain outcome means (see PaymentProviderError.kind).
 */

export interface CreateOrderInput {
  /** Minor units (paise). */
  amountMinor: number;
  currency: string;
  /** Our reference, at most 40 characters (the escrow payment id). */
  receipt: string;
  notes: Record<string, string>;
}

export interface ProviderOrder {
  id: string;
  amountMinor: number;
  currency: string;
  status: string;
}

export interface RefundInput {
  /** The provider's payment id (pay_…). */
  paymentId: string;
  amountMinor: number;
  /** Our refund row id. */
  receipt: string;
  notes: Record<string, string>;
}

export interface ProviderRefund {
  id: string;
  amountMinor: number;
  status: 'pending' | 'processed' | 'failed';
}

export interface PaymentProvider {
  createOrder(input: CreateOrderInput): Promise<ProviderOrder>;
  refund(input: RefundInput): Promise<ProviderRefund>;
}

/**
 * `rejected`: the provider answered and refused the request (4xx), so nothing was created.
 * `unavailable`: no usable answer (network error, timeout, 5xx); the request may or may not
 * have taken effect.
 */
export class PaymentProviderError extends Error {
  constructor(message: string, readonly kind: 'rejected' | 'unavailable', readonly status?: number) {
    super(message);
    this.name = 'PaymentProviderError';
  }
}

export const PAYMENT_PROVIDER = 'PAYMENT_PROVIDER';

const RAZORPAY_API = 'https://api.razorpay.com/v1';
const TIMEOUT_MS = 15_000;

type Fetch = typeof fetch;

/** Razorpay over HTTPS with basic auth. The key secret never leaves this object. */
export class RazorpayProvider implements PaymentProvider {
  private readonly auth: string;

  constructor(keyId: string, keySecret: string, private readonly http: Fetch = fetch) {
    this.auth = `Basic ${Buffer.from(`${keyId}:${keySecret}`).toString('base64')}`;
  }

  async createOrder(input: CreateOrderInput): Promise<ProviderOrder> {
    const body = await this.post<{ id: string; amount: number; currency: string; status: string }>('/orders', {
      amount: input.amountMinor,
      currency: input.currency,
      receipt: input.receipt.slice(0, 40),
      notes: input.notes,
    });
    return { id: body.id, amountMinor: Number(body.amount), currency: body.currency, status: body.status };
  }

  async refund(input: RefundInput): Promise<ProviderRefund> {
    const body = await this.post<{ id: string; amount: number; status: ProviderRefund['status'] }>(
      `/payments/${encodeURIComponent(input.paymentId)}/refund`,
      { amount: input.amountMinor, speed: 'normal', receipt: input.receipt.slice(0, 40), notes: input.notes },
    );
    return { id: body.id, amountMinor: Number(body.amount), status: body.status };
  }

  private async post<T>(path: string, payload: unknown): Promise<T> {
    let res: Response;
    try {
      res = await this.http(`${RAZORPAY_API}${path}`, {
        method: 'POST',
        headers: { Authorization: this.auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      const what = err instanceof Error && err.name === 'TimeoutError' ? 'timed out' : 'could not be reached';
      throw new PaymentProviderError(`Razorpay ${what}`, 'unavailable');
    }
    const text = await res.text().catch(() => '');
    let json: unknown = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    if (!res.ok) {
      // Razorpay errors look like { error: { code, description } }; they carry no secrets.
      const description = (json as { error?: { description?: string } } | null)?.error?.description;
      const message = `Razorpay ${res.status}${description ? `: ${description.slice(0, 200)}` : ''}`;
      // 4xx (429 included) means the request was refused; a 5xx may still have taken effect.
      throw new PaymentProviderError(message, res.status >= 500 ? 'unavailable' : 'rejected', res.status);
    }
    if (!json || typeof json !== 'object' || typeof (json as { id?: unknown }).id !== 'string') {
      throw new PaymentProviderError('Razorpay returned an unexpected response', 'unavailable', res.status);
    }
    return json as T;
  }
}
