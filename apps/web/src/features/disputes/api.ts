import { api } from '@/lib/api';
import type {
  CreateDisputeInput, Dispute, DisputeMessageInput, DisputeSummary, ResolveDisputeInput, ResolveDisputeResult,
} from './types';

export const disputeKey = (id: string) => `/disputes/${encodeURIComponent(id)}`;
export const disputesKey = (status?: string) => (status ? `/disputes?status=${encodeURIComponent(status)}` : '/disputes');

export const disputesApi = {
  list: (status?: string) => api.get<DisputeSummary[]>('/disputes', { status }),
  get: (id: string) => api.get<Dispute>(disputeKey(id)),
  create: (input: CreateDisputeInput) => api.post<Dispute>('/disputes', input),
  message: (id: string, input: DisputeMessageInput) => api.post<Dispute>(`${disputeKey(id)}/messages`, input),
  withdraw: (id: string) => api.post<Dispute>(`${disputeKey(id)}/withdraw`),
  resolve: (id: string, input: ResolveDisputeInput) => api.post<ResolveDisputeResult>(`${disputeKey(id)}/resolve`, input),
};
