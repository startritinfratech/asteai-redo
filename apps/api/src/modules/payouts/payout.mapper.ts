import type { PayoutAccount, PayoutMethod, PayoutRequest, PayoutStatus } from '../ledger/billing-types';

export interface PayoutAccountRow {
  user_id: string;
  method: PayoutMethod;
  account_holder: string;
  details_encrypted: string;
  account_last4: string | null;
  ifsc: string | null;
  upi_masked: string | null;
  verified: boolean;
  updated_at: Date | string;
}

export interface PayoutRequestRow {
  id: string;
  user_id: string;
  amount: string | number;
  currency: string;
  status: PayoutStatus;
  method: PayoutMethod;
  account_holder: string;
  account_masked: string;
  details_encrypted: string;
  admin_note: string | null;
  reference: string | null;
  requested_at: Date | string;
  decided_at: Date | string | null;
  decided_by: string | null;
  paid_at: Date | string | null;
  /** Admin list joins. */
  user_name?: string | null;
  user_email?: string | null;
}

const iso = (v: Date | string) => new Date(v).toISOString();
const isoOrNull = (v: Date | string | null) => (v == null ? null : iso(v));

export function mapPayoutAccount(row: PayoutAccountRow): PayoutAccount {
  const masked = row.method === 'bank'
    ? `XXXXXX${row.account_last4 ?? ''} · ${row.ifsc ?? ''}`
    : row.upi_masked ?? '';
  return {
    method: row.method,
    accountHolder: row.account_holder,
    masked,
    last4: row.account_last4,
    ifsc: row.ifsc,
    upiMasked: row.upi_masked,
    verified: row.verified,
    updatedAt: iso(row.updated_at),
  };
}

/** Never includes details_encrypted. */
export function mapPayoutRequest(row: PayoutRequestRow): PayoutRequest {
  return {
    id: row.id,
    userId: row.user_id,
    amount: Number(row.amount),
    currency: row.currency.trim(),
    status: row.status,
    method: row.method,
    accountHolder: row.account_holder,
    accountMasked: row.account_masked,
    adminNote: row.admin_note,
    reference: row.reference,
    requestedAt: iso(row.requested_at),
    decidedAt: isoOrNull(row.decided_at),
    paidAt: isoOrNull(row.paid_at),
    ...(row.user_name !== undefined ? { userName: row.user_name ?? '' } : {}),
    ...(row.user_email !== undefined ? { userEmail: row.user_email ?? '' } : {}),
  };
}
