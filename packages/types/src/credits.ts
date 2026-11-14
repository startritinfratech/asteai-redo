// ─── AI credits ──────────────────────────────────────────────────────────────
// JSON contract of /credits/* (apps/api/src/modules/credits), shared with the web wallet.

export const SUBSCRIPTION_TIERS = ['free', 'pro', 'enterprise'] as const;
export type SubscriptionTier = (typeof SUBSCRIPTION_TIERS)[number];

export const CREDIT_TX_TYPES = ['grant', 'topup', 'spend', 'refund'] as const;
export type CreditTxType = (typeof CREDIT_TX_TYPES)[number];
export type CreditTxStatus = 'pending' | 'completed' | 'refunded' | 'expired' | 'failed';

export interface WalletView {
  balance: number;
  subscriptionTier: SubscriptionTier;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
}

export interface CreditTransactionView {
  id: string;
  type: CreditTxType;
  amount: number;
  remainingAmount: number;
  expiresAt: string | null;
  featureKey: string | null;
  status: CreditTxStatus;
  createdAt: string;
}

/** What consumeCredits() hands the caller: the id to refund if the task fails. */
export interface CreditCharge {
  transactionId: string;
  cost: number;
  featureKey: string;
  balance: number;
}

/** Most a bulk pack may be discounted from its list price. */
export const MAX_PACK_DISCOUNT = 0.3;

export interface CreditPack {
  id: string;
  credits: number;
  /** What the buyer pays, in paise. */
  priceMinor: number;
  /** The same credits at the base rate, in paise (>= priceMinor). */
  listPriceMinor: number;
  /** Whole percent saved against the list price, 0–30. */
  discountPercent: number;
}

/** Everything Razorpay Checkout needs to open for a top-up. */
export interface TopupCheckout {
  orderId: string;
  keyId: string;
  amountMinor: number;
  currency: 'INR';
  credits: number;
}

/** Everything Razorpay Checkout needs to open for a subscription. */
export interface SubscriptionCheckout {
  subscriptionId: string;
  keyId: string;
  tier: SubscriptionTier;
  priceMinor: number;
}

/** 402 when a feature costs more than the wallet holds (the client sees `{ statusCode, message, errors }`). */
export interface InsufficientCreditsBody {
  message: string;
  errors: { code: 'INSUFFICIENT_CREDITS'; required: number; balance: number };
}

/** POST /credits/topups/verify. */
export interface TopupVerifyResult {
  status: 'credited' | 'amount_mismatch';
  wallet: WalletView;
}
