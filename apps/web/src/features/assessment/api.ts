import type { AssessmentStep } from '@asteai/types';
import { api } from '@/lib/api';

/** Foreground exits and pastes seen since the last answer. */
export interface IntegrityEvents {
  blur: number;
  paste: number;
}

export const assessmentApi = {
  /** Starts the assessment for an application, or resumes the one already started. */
  start: (requisitionId: string) => api.post<AssessmentStep>('/assessments/sessions', { requisitionId }),

  answer: (sessionId: string, itemId: string, response: Record<string, unknown>, events: IntegrityEvents) =>
    api.post<AssessmentStep>(`/assessments/sessions/${encodeURIComponent(sessionId)}/answer`, {
      itemId,
      response,
      events,
    }),
};
