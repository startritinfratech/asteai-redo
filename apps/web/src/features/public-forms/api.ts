import type {
  CareerApplicationInput, CareerRole, ContactInput, FormReceipt, LeadInput, NewsletterInput, NewsletterResult,
  SendOtpResult, VerifyOtpResult,
} from '@asteai/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { SUPPORT_EMAIL } from '@/lib/site';

export const publicFormsApi = {
  lead: (input: LeadInput) => api.post<FormReceipt>('/leads', input),
  contact: (input: ContactInput) => api.post<FormReceipt>('/contact', input),
  subscribe: (input: NewsletterInput) => api.post<NewsletterResult>('/newsletter/subscribe', input),
  confirm: (token: string) => api.post<{ status: 'subscribed' }>('/newsletter/confirm', { token }),
  unsubscribe: (token: string) => api.post<{ status: 'unsubscribed' }>('/newsletter/unsubscribe', { token }),
  careerRoles: () => api.get<CareerRole[]>('/careers/roles'),
  apply: (input: CareerApplicationInput) => api.post<FormReceipt>('/careers/applications', input),
  sendOtp: (email: string, turnstileToken?: string) =>
    api.post<SendOtpResult>('/auth/email/send-otp', { email, turnstileToken: turnstileToken || undefined }),
  verifyOtp: (email: string, code: string) => api.post<VerifyOtpResult>('/auth/email/verify-otp', { email, code }),
};

/** A public-form failure as a sentence, with the support address as the way out. */
export function formErrorMessage(err: unknown): string {
  if (err instanceof ApiError) {
    if (err.status === 429) return 'Too many submissions from this connection. Please wait a minute and try again.';
    if (err.status >= 500) return `Something went wrong on our side. Please try again, or email ${SUPPORT_EMAIL}.`;
    if (err.status === 400 || err.status === 404) return err.message;
  }
  if (err instanceof TypeError) return 'We couldn’t reach ASTEAI. Check your connection and try again.';
  return errorMessage(err, `We couldn’t send this. Please try again, or email ${SUPPORT_EMAIL}.`);
}
