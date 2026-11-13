// ─── Payments (Razorpay) ─────────────────────────────────────────────────────
// Shared by apps/api (modules/payments, modules/contracts) and apps/web (features/payments,
// features/contracts). Re-exported from ./index (`export * from './payment'`).

export const PAYMENT_PROVIDERS = ['razorpay'] as const;
export type PaymentProviderName = typeof PAYMENT_PROVIDERS[number];

/** What a payment order pays for. Extend together with migration 011's CHECK. */
export const PAYMENT_PURPOSES = ['escrow_milestone'] as const;
export type PaymentPurpose = typeof PAYMENT_PURPOSES[number];

export const PAYMENT_ORDER_STATUSES = ['created', 'attempted', 'paid', 'failed', 'expired', 'unapplied', 'refunded'] as const;
export type PaymentOrderStatus = typeof PAYMENT_ORDER_STATUSES[number];

export const REFUND_STATUSES = ['pending', 'processed', 'failed'] as const;
export type RefundStatus = typeof REFUND_STATUSES[number];

/**
 * POST /contracts/:id/milestones/:mid/fund: what the web checkout needs. The milestone is
 * NOT funded until the provider confirms the payment (verify or webhook).
 */
export interface FundMilestoneCheckout {
  /** Our escrow payment id. */
  paymentId: string;
  /** Razorpay order id (order_…). */
  orderId: string;
  /** In the contract currency's major unit (rupees). */
  amount: number;
  /** What Razorpay charges, in the minor unit (paise). Pass this to the checkout. */
  amountMinor: number;
  currency: string;
  /** Razorpay key id (public). */
  keyId: string;
  provider: PaymentProviderName;
  status: 'pending';
}

/** POST /payments/razorpay/verify body: the fields Razorpay Checkout hands to `handler`. */
export interface VerifyCheckoutInput {
  orderId: string;
  paymentId: string;
  signature: string;
}

/** POST /payments/razorpay/verify. */
export interface VerifyCheckoutResult {
  status: 'captured';
  /** The webhook (or an earlier verify) got there first. */
  alreadyCaptured: boolean;
}

export interface Refund {
  id: string;
  contractId: string;
  escrowPaymentId: string;
  amount: number;
  currency: string;
  status: RefundStatus;
  providerRefundId: string | null;
  reason: string;
  error: string | null;
  createdAt: string;
  processedAt: string | null;
}

/** POST /contracts/:id/refund body (Admin). Without `amount`, refunds everything still due. */
export interface IssueRefundInput {
  reason: string;
  amount?: number;
}

/** POST /contracts/:id/refund. */
export interface IssueRefundResult {
  contractId: string;
  /** The refunds this request started. */
  refunds: Refund[];
  /** contracts.refund_due after the request (it drops when a refund is processed). */
  refundDue: number;
}
