/**
 * AI interviews: types and calls to /api/v1/interviews. The interview itself runs on
 * deeptech_ai over a WebSocket; this API starts it and stores the result.
 */
import { api, apiRequest } from './api';

export type FieldCategory = 'tech' | 'non-tech' | 'frontline';

export interface Catalogue {
  categories: { id: FieldCategory; label: string }[];
  domains: { tech: string[]; 'non-tech': string[] };
  frontline: { field: string; group: string; roles: { roleId: string; label: string }[] }[];
  languages: { code: string; label: string }[];
}

export type InterviewStatus = 'in_progress' | 'completed' | 'abandoned';

export interface MockInterviewSummary {
  id: string;
  category: FieldCategory;
  skill: string;
  domain: string;
  language: string;
  frontline_role_id: string | null;
  status: InterviewStatus;
  turns: number;
  ended_reason: string | null;
  started_at: string;
  completed_at: string | null;
  overall_score: string | number | null;
  has_certificate: boolean;
}

export interface ConversationTurn {
  role: 'user' | 'assistant';
  content: { text: string }[];
}

export interface MockInterviewDetail extends MockInterviewSummary {
  summary: string;
  conversation: ConversationTurn[];
  proctoring_summary: Record<string, any>;
  interview_details: Record<string, any>;
}

export interface Connection {
  wsUrl: string;
  faceCheckUrl: string;
  token: string;
  expiresInSeconds: number;
}

export interface PartOneResult {
  status: string;
  eq_score?: string | number | null;
  resilience_score?: string | number | null;
  grit_score?: string | number | null;
  result?: Record<string, any>;
  scored_at?: string | null;
}

export const interviewsApi = {
  catalogue: () => api.get<Catalogue>('/interviews/catalogue'),
  start: (body: { category: FieldCategory; domain: string; skill: string; summary?: string; language: string }) =>
    api.post<{ interview: MockInterviewSummary; connection: Connection }>('/interviews/mock', body),
  session: (id: string) => api.post<Connection>(`/interviews/mock/${id}/session`),
  list: () => api.get<MockInterviewSummary[]>('/interviews/mock'),
  detail: (id: string) => api.get<MockInterviewDetail>(`/interviews/mock/${id}`),
  assessment: (id: string) => api.get<PartOneResult>(`/interviews/mock/${id}/assessment`),
};

/**
 * Downloads the PDF. The endpoint needs the bearer token, so a plain link will not do;
 * apiRequest also refreshes an expired token and throws ApiError on failure.
 */
export async function downloadCertificate(id: string): Promise<void> {
  const res = await apiRequest(`/interviews/mock/${id}/certificate`);
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `asteai-certificate-${id}.pdf`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const toNumber = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function statusTag(status: InterviewStatus): { label: string; color: 'mint' | 'amber' | 'grey' } {
  if (status === 'completed') return { label: 'Completed', color: 'mint' };
  if (status === 'in_progress') return { label: 'In progress', color: 'amber' };
  return { label: 'Not finished', color: 'grey' };
}
