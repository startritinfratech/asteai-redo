import { api } from '@/lib/api';
import type { Contract, ContractSummary, CreateContractInput, FundMilestoneResult } from './types';

export const contractKey = (id: string) => `/contracts/${encodeURIComponent(id)}`;
const ms = (id: string, mid: string, action: string) =>
  `${contractKey(id)}/milestones/${encodeURIComponent(mid)}/${action}`;

export const contractsApi = {
  list: (status?: string) => api.get<ContractSummary[]>('/contracts', { status }),
  get: (id: string) => api.get<Contract>(contractKey(id)),
  create: (input: CreateContractInput) => api.post<Contract>('/contracts', input),
  sign: (id: string, signatureName: string) => api.post<Contract>(`${contractKey(id)}/sign`, { signatureName }),
  decline: (id: string, reason?: string) => api.post<Contract>(`${contractKey(id)}/decline`, reason ? { reason } : {}),
  cancel: (id: string, reason: string) =>
    api.post<Contract & { refundDue: number }>(`${contractKey(id)}/cancel`, { reason }),
  fund: (id: string, mid: string) => api.post<FundMilestoneResult>(ms(id, mid, 'fund')),
  submit: (id: string, mid: string, note: string) => api.post<Contract>(ms(id, mid, 'submit'), { note }),
  requestRevision: (id: string, mid: string, note: string) =>
    api.post<Contract>(ms(id, mid, 'request-revision'), { note }),
  accept: (id: string, mid: string) => api.post<Contract>(ms(id, mid, 'accept')),
  release: (id: string, mid: string) => api.post<Contract>(ms(id, mid, 'release')),
};
