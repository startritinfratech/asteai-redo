import { api } from '@/lib/api';
import type { FundMilestoneCheckout, IssueRefundInput, IssueRefundResult } from '../payments/types';
import type { Contract, ContractSummary, CreateContractInput } from './types';

export const contractKey = (id: string) => `/contracts/${encodeURIComponent(id)}`;
const ms = (id: string, mid: string, action: string) =>
  `${contractKey(id)}/milestones/${encodeURIComponent(mid)}/${action}`;

export const contractsApi = {
  list: (status?: string) => api.get<ContractSummary[]>('/contracts', { status }),
  get: (id: string) => api.get<Contract>(contractKey(id)),
  create: (input: CreateContractInput) => api.post<Contract>('/contracts', input),
  sign: (id: string, signatureName: string) => api.post<Contract>(`${contractKey(id)}/sign`, { signatureName }),
  decline: (id: string, reason?: string) => api.post<Contract>(`${contractKey(id)}/decline`, reason ? { reason } : {}),
  cancel: (id: string, reason: string) => api.post<Contract>(`${contractKey(id)}/cancel`, { reason }),
  /** Opens (or reopens) the escrow payment and its Razorpay order; pay it with payWithRazorpay. */
  fund: (id: string, mid: string) => api.post<FundMilestoneCheckout>(ms(id, mid, 'fund')),
  /** Admin: refund (part of) the escrow due on a cancelled contract. */
  refund: (id: string, input: IssueRefundInput) => api.post<IssueRefundResult>(`${contractKey(id)}/refund`, input),
  submit: (id: string, mid: string, note: string) => api.post<Contract>(ms(id, mid, 'submit'), { note }),
  requestRevision: (id: string, mid: string, note: string) =>
    api.post<Contract>(ms(id, mid, 'request-revision'), { note }),
  accept: (id: string, mid: string) => api.post<Contract>(ms(id, mid, 'accept')),
  release: (id: string, mid: string) => api.post<Contract>(ms(id, mid, 'release')),
};
