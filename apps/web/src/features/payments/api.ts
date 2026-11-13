import { api } from '@/lib/api';
import type { VerifyCheckoutInput, VerifyCheckoutResult } from './types';

export const paymentsApi = {
  /** The Checkout `handler` result; the API checks the signature and captures the payment. */
  verifyRazorpay: (input: VerifyCheckoutInput) => api.post<VerifyCheckoutResult>('/payments/razorpay/verify', input),
};
