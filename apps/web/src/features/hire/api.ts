import type {
  ApplicationStage, ApplicationSummary, GeneratedJobResponse, HiringKpis, JobBand, OutreachEmailCampaign, PoolBoard, PoolColumn,
  PoolMember, Requisition, RequisitionPosting, TalentPoolSummary, MessageDelivery,
} from '@asteai/types';
import { api, apiRequest } from '@/lib/api';

export const HIRE_KEYS = {
  kpis: '/analytics/employer/hiring-kpis',
  approvals: (status = 'pending') => `/admin/requisitions/approvals?status=${status}`,
  applications: (reqId: string) => `/applications/requisition/${encodeURIComponent(reqId)}`,
  pools: '/talent-pools',
  board: (id: string) => `/talent-pools/${encodeURIComponent(id)}/board`,
  campaigns: '/outreach/campaigns',
  campaign: (id: string) => `/outreach/campaigns/${encodeURIComponent(id)}`,
  messages: (id: string) => `/outreach/campaigns/${encodeURIComponent(id)}/messages`,
  creditCosts: '/public-settings/credits',
} as const;

export type CreateRequisitionBody = {
  title: string; industry: string; func: string; echLevel: number;
  tier: 'Technical' | 'Non-Technical' | 'Frontline' | 'Skilled';
  weights: { iq: number; eq: number; grit: number }; lang: string; location?: string; headcount: number;
  stack?: string[]; brief?: string;
  screeningQuestions?: Requisition['screeningQuestions']; evaluationRubric?: Requisition['evaluationRubric'];
};

export interface CampaignMessage {
  id: string; email: string; name: string; delivery: MessageDelivery; scheduledFor: string; sentAt: string | null;
  skipReason: string | null; error: string | null;
}

const enc = encodeURIComponent;

export const hireApi = {
  // Requisitions
  createRequisition: (body: CreateRequisitionBody) => api.post<Requisition>('/requisitions', body),
  updateRequisition: (id: string, body: Partial<CreateRequisitionBody> & { status?: Requisition['status'] }) =>
    api.put<Requisition>(`/requisitions/${enc(id)}`, body),
  setPosting: (id: string, body: Partial<Pick<RequisitionPosting, 'isPublic' | 'employmentType' | 'locationType'>>) =>
    api.patch<Requisition>(`/requisitions/${enc(id)}/posting`, body),
  submitForApproval: (id: string) => api.post<Requisition>(`/requisitions/${enc(id)}/submit-for-approval`),
  deleteRequisition: (id: string) => apiRequest(`/requisitions/${enc(id)}`, { method: 'DELETE' }),
  approve: (id: string, note?: string) => api.post<Requisition>(`/admin/requisitions/${enc(id)}/approve`, note ? { note } : {}),
  reject: (id: string, note: string) => api.post<Requisition>(`/admin/requisitions/${enc(id)}/reject`, { note }),

  // AI Job Creator
  generateJob: (body: { rolePrompt: string; stack: string[]; band: JobBand; location?: string; industry?: string; screeningQuestionCount?: number }) =>
    api.post<GeneratedJobResponse>('/ai/jobs/generate', body),

  // Pipeline
  moveApplication: (id: string, body: { stage: ApplicationStage; expectedStage: ApplicationStage; reason?: string }) =>
    api.patch<ApplicationSummary>(`/applications/${enc(id)}/stage`, body),

  // Pools
  createPool: (body: { name: string; description?: string; columns?: PoolColumn[] }) => api.post<TalentPoolSummary>(HIRE_KEYS.pools, body),
  updatePool: (id: string, body: { name?: string; columns?: PoolColumn[] }) => api.patch<TalentPoolSummary>(`/talent-pools/${enc(id)}`, body),
  archivePool: (id: string) => api.delete<{ archived: true }>(`/talent-pools/${enc(id)}`),
  addMembers: (id: string, body: { column?: string; members: { email: string; fullName?: string }[] }) =>
    api.post<{ added: number; alreadyInPool: number; invalid: string[] }>(`/talent-pools/${enc(id)}/members`, body),
  moveMember: (poolId: string, memberId: string, body: { column: string; beforeId?: string; afterId?: string }) =>
    api.patch<PoolMember>(`/talent-pools/${enc(poolId)}/members/${enc(memberId)}/move`, body),
  removeMember: (poolId: string, memberId: string) => api.delete<{ removed: true }>(`/talent-pools/${enc(poolId)}/members/${enc(memberId)}`),

  // Outreach
  createCampaign: (body: {
    name: string; subjectTemplate: string; bodyTemplate: string; ratePerMinute: number; requisitionId?: string;
    poolId?: string; poolColumns?: string[]; recipients?: { email: string; fullName?: string }[];
  }) => api.post<OutreachEmailCampaign>(HIRE_KEYS.campaigns, body),
  queueCampaign: (id: string) => api.post<OutreachEmailCampaign>(`/outreach/campaigns/${enc(id)}/queue`),
  cancelCampaign: (id: string) => api.post<OutreachEmailCampaign>(`/outreach/campaigns/${enc(id)}/cancel`),
};

export type { HiringKpis, PoolBoard };
