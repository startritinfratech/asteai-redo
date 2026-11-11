// Pure helpers for the wallet, invoices and payouts UI. The account patterns mirror
// packages/types/src/billing.ts (the API checks them again).
import type { TagColor } from '@/components/ui';
import type { PayoutAccountInput, PayoutMethod, PayoutStatus } from './types';

const IFSC_PATTERN = /^[A-Z]{4}0[A-Z0-9]{6}$/;
const ACCOUNT_NUMBER_PATTERN = /^\d{9,18}$/;
const UPI_PATTERN = /^[\w.-]{2,}@[a-zA-Z]{2,}$/;

export function formatInr(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export function formatDate(iso: string | number): string {
  return new Date(iso).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

export const PAYOUT_STATUS_LABEL: Record<PayoutStatus, string> = {
  requested: 'Requested',
  approved: 'Approved',
  paid: 'Paid',
  rejected: 'Rejected',
  cancelled: 'Cancelled',
};

export function payoutStatusColor(status: PayoutStatus): TagColor {
  switch (status) {
    case 'paid': return 'mint';
    case 'approved': return 'gold';
    case 'requested': return 'amber';
    case 'rejected': return 'rose';
    default: return 'grey';
  }
}

export interface AccountForm {
  method: PayoutMethod;
  accountHolder: string;
  accountNumber: string;
  ifsc: string;
  upiId: string;
}

export type ParsedAccountForm = { input: PayoutAccountInput; error: null } | { input: null; error: string };

/** The PUT /payouts/account body for the form, or the first problem with it. */
export function parseAccountForm(form: AccountForm): ParsedAccountForm {
  const accountHolder = form.accountHolder.trim();
  if (accountHolder.length < 2) return { input: null, error: 'Enter the account holder name' };
  if (form.method === 'bank') {
    const accountNumber = form.accountNumber.replace(/[\s-]/g, '');
    const ifsc = form.ifsc.trim().toUpperCase();
    if (!ACCOUNT_NUMBER_PATTERN.test(accountNumber)) return { input: null, error: 'Account number must be 9 to 18 digits' };
    if (!IFSC_PATTERN.test(ifsc)) return { input: null, error: 'IFSC must look like HDFC0001234' };
    return { input: { method: 'bank', accountHolder, accountNumber, ifsc }, error: null };
  }
  const upiId = form.upiId.trim();
  if (!UPI_PATTERN.test(upiId)) return { input: null, error: 'UPI id must look like name@bank' };
  return { input: { method: 'upi', accountHolder, upiId }, error: null };
}

export type ParsedAmount = { amount: number; error: null } | { amount: null; error: string };

const toMinor = (n: number) => Math.round(n * 100);

/** A payout amount typed by the expert: two decimals at most, within [minimum, available]. */
export function parsePayoutAmount(text: string, minimum: number, available: number): ParsedAmount {
  const clean = text.replace(/[,\s₹]/g, '');
  if (!/^\d+(\.\d{1,2})?$/.test(clean)) return { amount: null, error: 'Enter an amount in rupees, e.g. 2500 or 2500.50' };
  const amount = Number(clean);
  if (toMinor(amount) < toMinor(minimum)) return { amount: null, error: `The minimum payout is ${formatInr(minimum)}` };
  if (toMinor(amount) > toMinor(available)) return { amount: null, error: `You can withdraw up to ${formatInr(available)}` };
  return { amount, error: null };
}
