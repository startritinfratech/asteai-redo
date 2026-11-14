import type {
  CreditPack, CreditTransactionView, PublicCreditSettings, SubscriptionCheckout, TopupCheckout, TopupVerifyResult,
  WalletView,
} from '@asteai/types';
import { api } from '@/lib/api';

/** SWR keys (GET paths) of the credits API. */
export const CREDIT_WALLET_KEY = '/credits/wallet';
export const CREDIT_PACKS_KEY = '/credits/packs';
/** Public credit costs (labels for spends in the history). */
export const CREDIT_SETTINGS_KEY = '/public-settings/credits';
export const creditTransactionsKey = (page: number) => `/credits/transactions?page=${page}`;
/** Matches the API's page size: a shorter page is the last one. */
export const CREDIT_PAGE_SIZE = 50;

export const creditsApi = {
  wallet: () => api.get<WalletView>(CREDIT_WALLET_KEY),
  packs: () => api.get<CreditPack[]>(CREDIT_PACKS_KEY),
  transactions: (page: number) => api.get<CreditTransactionView[]>(creditTransactionsKey(page)),
  settings: () => api.get<PublicCreditSettings>(CREDIT_SETTINGS_KEY),
  createTopup: (packId: string) => api.post<TopupCheckout>('/credits/topups', { packId }),
  verifyTopup: (input: { orderId: string; paymentId: string; signature: string }) =>
    api.post<TopupVerifyResult>('/credits/topups/verify', input),
  subscribePro: () => api.post<SubscriptionCheckout>('/credits/subscriptions', { tier: 'pro' }),
};
