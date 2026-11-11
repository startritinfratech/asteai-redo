import { api, apiRequest } from '@/lib/api';
import type { PayoutAccount, PayoutAccountInput, PayoutDestination, PayoutRequest } from './types';

export const WALLET_KEY = '/ledger/wallet';
export const LEDGER_ENTRIES_KEY = '/ledger/entries';
export const PAYOUTS_KEY = '/payouts';
export const PAYOUT_ACCOUNT_KEY = '/payouts/account';
export const INVOICES_KEY = '/invoices';
export const adminPayoutsKey = (status?: string) =>
  (status ? `/admin/payouts?status=${encodeURIComponent(status)}` : '/admin/payouts');

const adminPayout = (id: string, action: string) => `/admin/payouts/${encodeURIComponent(id)}/${action}`;

export const billingApi = {
  saveAccount: (input: PayoutAccountInput) => api.put<PayoutAccount>(PAYOUT_ACCOUNT_KEY, input),
  requestPayout: (amount: number) => api.post<PayoutRequest>(PAYOUTS_KEY, { amount }),
  cancelPayout: (id: string) => api.post<PayoutRequest>(`/payouts/${encodeURIComponent(id)}/cancel`),
  details: (id: string) => api.get<PayoutDestination>(adminPayout(id, 'details')),
  approve: (id: string) => api.post<PayoutRequest>(adminPayout(id, 'approve')),
  markPaid: (id: string, reference: string) => api.post<PayoutRequest>(adminPayout(id, 'mark-paid'), { reference }),
  reject: (id: string, note: string) => api.post<PayoutRequest>(adminPayout(id, 'reject'), { note }),
};

/** Downloads GET /invoices/:id/pdf (authenticated, so not a plain link). */
export async function downloadInvoicePdf(id: string): Promise<void> {
  const res = await apiRequest(`/invoices/${encodeURIComponent(id)}/pdf`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
