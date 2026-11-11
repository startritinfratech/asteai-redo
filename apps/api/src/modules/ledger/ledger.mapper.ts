import type { LedgerEntry, LedgerType } from '@asteai/types';
import type { WalletLedgerGroup } from './wallet';

export interface LedgerRow {
  id: string;
  tenant_id: string | null;
  user_id: string | null;
  type: string;
  description: string;
  amount: string | number; // NUMERIC arrives as a string
  unit: string | null;
  payee_id: string | null;
  fee: string | number | null;
  by: string;
  ref: string | null;
  created_at: Date | string;
}

export function mapLedgerRow(row: LedgerRow): LedgerEntry {
  return {
    id: row.id,
    t: new Date(row.created_at).getTime(),
    tenantId: row.tenant_id ?? '',
    type: row.type as LedgerType,
    description: row.description,
    amount: Number(row.amount),
    unit: row.unit ?? undefined,
    payee: row.payee_id ?? undefined,
    fee: row.fee == null ? undefined : Number(row.fee),
    by: row.by,
    ref: row.ref ?? '',
  };
}

/** A `GROUP BY type, ref, user_id, payee_id` row behind the wallet (see wallet.ts). */
export interface WalletGroupRow {
  type: string;
  ref: string | null;
  user_id: string | null;
  payee_id: string | null;
  total: string | number;
}

export function mapWalletGroup(row: WalletGroupRow): WalletLedgerGroup {
  return { type: row.type, ref: row.ref, userId: row.user_id, payeeId: row.payee_id, total: Number(row.total) };
}
