import type { Invoice } from '../ledger/billing-types';

export interface InvoiceRow {
  id: string;
  contract_id: string;
  milestone_id: string;
  escrow_payment_id: string;
  buyer_id: string;
  expert_id: string;
  amount: string | number;
  platform_fee: string | number;
  currency: string;
  gstin: string | null;
  tax_amount: string | number | null;
  provider: string | null;
  provider_payment_id: string | null;
  buyer_name: string;
  buyer_email: string;
  expert_name: string;
  project_title: string;
  milestone_seq: number;
  milestone_title: string;
  issued_at: Date | string;
}

/** Leaves out buyer_email (not needed by either party's view). */
export function mapInvoice(row: InvoiceRow): Invoice {
  const amount = Number(row.amount);
  const taxAmount = row.tax_amount == null ? null : Number(row.tax_amount);
  return {
    id: row.id,
    contractId: row.contract_id,
    milestoneId: row.milestone_id,
    escrowPaymentId: row.escrow_payment_id,
    buyerId: row.buyer_id,
    expertId: row.expert_id,
    amount,
    platformFee: Number(row.platform_fee),
    currency: row.currency.trim(),
    gstin: row.gstin,
    taxAmount,
    total: Math.round((amount + (taxAmount ?? 0)) * 100) / 100,
    buyerName: row.buyer_name,
    expertName: row.expert_name,
    projectTitle: row.project_title,
    milestoneSeq: Number(row.milestone_seq),
    milestoneTitle: row.milestone_title,
    providerPaymentId: row.provider_payment_id,
    issuedAt: new Date(row.issued_at).toISOString(),
  };
}
