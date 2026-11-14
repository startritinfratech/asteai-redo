import type {
  ApplicationSummary, ChallengeDetail, ChallengeSummary, ChallengeTelemetry, CompetencyBenchmark, IssuedCredential,
  PassportProfile, ResumeAutofillResult, ResumeDraft, ResumeUploadTicket, StudioCompletion, StudioMode,
  StudioRubricResult, StudioTurnResponse, SubmissionResult, VerificationResult,
} from '@asteai/types';
import { api, apiRequest } from '@/lib/api';

/** SWR keys (GET paths). */
export const CAREER_KEYS = {
  applications: '/applications/me',
  passport: '/passports/me/profile',
  benchmarks: '/passports/benchmarks',
  challenges: '/challenges',
  challenge: (id: string) => `/challenges/${encodeURIComponent(id)}`,
  submissions: (id: string) => `/challenges/${encodeURIComponent(id)}/submissions`,
  catalogue: '/interviews/catalogue',
  resume: '/resumes/me',
  credentials: '/credentials/me',
} as const;

/** GET /interviews/catalogue (the setup form's fields, roles and languages). */
export interface InterviewCatalogue {
  domains: { tech: string[]; 'non-tech': string[] };
  frontline: { field: string; group: string; roles: { roleId: string; label: string }[] }[];
  languages: { code: string; label: string }[];
}

export interface StudioSession {
  sessionId: string;
  mode: StudioMode;
  domain: string;
  skill: string;
  language: string;
  status: 'active' | 'completed' | 'abandoned';
  transcript: { role: 'interviewer' | 'candidate'; text: string; at: string }[];
  rubric: StudioRubricResult | null;
  credentialCode: string | null;
}

export interface LatestResume {
  uploadId: string;
  fileKind: 'pdf' | 'docx';
  fileName: string;
  sizeBytes: number;
  status: 'pending' | 'parsed' | 'rejected';
  draft: ResumeDraft | null;
  uploadedAt: string;
}

export const careerApi = {
  // Passport
  updatePassport: (patch: { slug?: string; headline?: string; visibility?: 'public' | 'private' }) =>
    api.patch<PassportProfile>(CAREER_KEYS.passport, patch),
  issueSnapshot: () => api.post<IssuedCredential>('/passports/me/credentials'),
  verify: (code: string) => api.get<VerificationResult>(`/verify/${encodeURIComponent(code)}`),
  benchmarks: () => api.get<CompetencyBenchmark[]>(CAREER_KEYS.benchmarks),

  // Challenges
  challenges: () => api.get<ChallengeSummary[]>(CAREER_KEYS.challenges),
  challenge: (id: string) => api.get<ChallengeDetail>(CAREER_KEYS.challenge(id)),
  submit: (id: string, body: { language: string; source: string; telemetry: ChallengeTelemetry }) =>
    api.post<SubmissionResult>(CAREER_KEYS.submissions(id), body),

  // Interview Studio
  startInterview: (body: { mode: StudioMode; domain: string; skill: string; language: string }) =>
    api.post<StudioTurnResponse>('/interviews/start', body),
  answer: (id: string, body: {
    answer: string; inputMode: 'text' | 'voice'; detectedLanguage?: string; speech?: { durationMs?: number; confidence?: number };
  }) => api.post<StudioTurnResponse>(`/interviews/${encodeURIComponent(id)}/turn`, body),
  complete: (id: string) => api.post<StudioCompletion>(`/interviews/${encodeURIComponent(id)}/complete`),
  session: (id: string) => api.get<StudioSession>(`/interviews/sessions/${encodeURIComponent(id)}`),

  // Résumé
  resumeUploadUrl: (body: { fileName: string; contentType: string; sizeBytes: number }) =>
    api.post<ResumeUploadTicket>('/resumes/upload-url', body),
  autofill: (uploadId: string) => api.post<ResumeAutofillResult>(`/resumes/${encodeURIComponent(uploadId)}/autofill`),
  applyToProfile: (fields: Record<string, unknown>) => apiRequest('/profiles/me', { method: 'PUT', body: fields }),
};

/** PUTs the file straight to S3 with the ticket's signed headers (not through the API). */
export async function uploadToS3(ticket: ResumeUploadTicket, file: File, onProgress?: (fraction: number) => void): Promise<void> {
  // XHR rather than fetch: fetch has no upload progress.
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(ticket.method, ticket.url);
    for (const [k, v] of Object.entries(ticket.headers)) xhr.setRequestHeader(k, v);
    xhr.upload.onprogress = (e) => { if (e.lengthComputable) onProgress?.(e.loaded / e.total); };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error(`Upload failed (${xhr.status})`)));
    xhr.onerror = () => reject(new Error('Upload failed. Check your connection and try again.'));
    xhr.send(file);
  });
}

export type { ApplicationSummary };
