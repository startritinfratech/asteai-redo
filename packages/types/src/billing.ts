// Billing: wallet balances, invoices and expert payouts.
// Amounts are in rupees (two decimals) unless a currency says otherwise.

// ─── Wallet ──────────────────────────────────────────────────────────────────

/** The expert (payee) side of a wallet. */
export interface ExpertWalletBalances {
  /** Escrow releases to this user, plus any refund adjustments (clawbacks are negative). */
  earned: number;
  /** Platform 'Fee' ledger rows charged to this user. */
  fees: number;
  /** 'Payout' ledger rows: money already paid out to the bank account / UPI id. */
  paidOut: number;
  /** Payout requests not yet paid (requested or approved): reserved, not available. */
  payoutsPending: number;
  /** earned − fees − paidOut − payoutsPending, never below 0. What a new payout may ask for. */
  available: number;
  /** Funded by buyers for this expert's milestones and not yet released, refunded or cancelled. */
  inEscrow: number;
}

/** The buyer (payer) side of a wallet. */
export interface BuyerWalletBalances {
  /** Paid into escrow ('Escrow hold' rows). */
  funded: number;
  /** Of that, released to experts. */
  released: number;
  /** Refunded back to this buyer ('Refund' ledger rows). */
  refunded: number;
  /** Still held for open milestones. */
  inEscrow: number;
  /** Held for cancelled milestones and not refunded yet: owed back to this buyer. */
  refundDue: number;
}

/**
 * GET /ledger/wallet. `earned`, `fees` and `pending` keep their original meaning for
 * older clients: expert earnings, fees, and money in escrow (either side).
 */
export interface WalletBalances {
  currency: 'INR';
  earned: number;
  fees: number;
  pending: number;
  expert: ExpertWalletBalances;
  buyer: BuyerWalletBalances;
}

// ─── Invoices ────────────────────────────────────────────────────────────────

/** An invoice (payment receipt) for one captured escrow payment. */
export interface Invoice {
  id: string;                 // 'INV-2026-000123'
  contractId: string;
  milestoneId: string;
  escrowPaymentId: string;
  buyerId: string;
  expertId: string;
  amount: number;
  platformFee: number;
  currency: string;
  gstin: string | null;
  taxAmount: number | null;
  /** amount + taxAmount. */
  total: number;
  buyerName: string;
  expertName: string;
  projectTitle: string;
  milestoneSeq: number;
  milestoneTitle: string;
  providerPaymentId: string | null;
  issuedAt: string;           // ISO
}

// ─── Payouts ─────────────────────────────────────────────────────────────────

export const PAYOUT_METHODS = ['bank', 'upi'] as const;
export type PayoutMethod = typeof PAYOUT_METHODS[number];

export const PAYOUT_STATUSES = ['requested', 'approved', 'paid', 'rejected', 'cancelled'] as const;
export type PayoutStatus = typeof PAYOUT_STATUSES[number];

/** Statuses that still reserve money and block a second request. */
export const OPEN_PAYOUT_STATUSES: readonly PayoutStatus[] = ['requested', 'approved'];

/** Minimum payout when PAYOUT_MIN is not set (INR). */
export const DEFAULT_PAYOUT_MIN = 500;

/** IFSC: 4 letters (bank), a zero, 6 letters/digits (branch). */
export const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
/** Indian bank account numbers are 9 to 18 digits. */
export const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
/** handle@provider, e.g. name.surname@okhdfc. */
export const UPI_PATTERN = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;

/** GET /payouts/account: what the expert sees (never the full account number). */
export interface PayoutAccount {
  method: PayoutMethod;
  accountHolder: string;
  /** 'XXXXXX1234 · HDFC0001234' or 'ra****@okhdfc'. */
  masked: string;
  last4: string | null;
  ifsc: string | null;
  upiMasked: string | null;
  verified: boolean;
  updatedAt: string;
}

/** PUT /payouts/account. Bank: accountNumber + ifsc. UPI: upiId. */
export interface PayoutAccountInput {
  method: PayoutMethod;
  accountHolder: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
}

export interface PayoutRequest {
  id: string;
  userId: string;
  amount: number;
  currency: string;
  status: PayoutStatus;
  method: PayoutMethod;
  accountHolder: string;
  accountMasked: string;
  adminNote: string | null;
  reference: string | null;
  requestedAt: string;
  decidedAt: string | null;
  paidAt: string | null;
  /** Admin views only. */
  userName?: string;
  userEmail?: string;
}

/** GET /admin/payouts/:id/details: the unmasked destination, for the admin making the transfer. */
export interface PayoutDestination {
  method: PayoutMethod;
  accountHolder: string;
  accountNumber?: string;
  ifsc?: string;
  upiId?: string;
}

/** GET /payouts: the expert's requests plus the numbers the request form needs. */
export interface PayoutOverview {
  minimum: number;
  available: number;
  requests: PayoutRequest[];
}
