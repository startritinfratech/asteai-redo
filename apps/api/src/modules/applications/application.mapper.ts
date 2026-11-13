import type { Application, ApplicationStage, ApplicationSummary, CandidateTier, HistoryEntry } from '@asteai/types';

export interface ApplicationRow {
  id: string;
  candidate_id: string;
  requisition_id: string;
  tenant_id: string;
  stage: ApplicationStage;
  result_id: string | null;
  notes: string[] | null;
  interview: Application['interview'];
  offer: Application['offer'];
  history: HistoryEntry[] | null;
  created_at: Date | string;
  // Optional joined columns
  req_title?: string;
  industry?: string;
  tier?: CandidateTier;
  candidate_name?: string;
  candidate_email?: string;
}

export function mapApplicationRow(row: ApplicationRow): ApplicationSummary {
  return {
    id: row.id,
    candidateId: row.candidate_id,
    requisitionId: row.requisition_id,
    tenantId: row.tenant_id,
    stage: row.stage,
    t: new Date(row.created_at).getTime(),
    resultId: row.result_id,
    notes: row.notes ?? [],
    scorecards: [],
    interview: row.interview ?? null,
    offer: row.offer ?? null,
    history: row.history ?? [],
    requisitionTitle: row.req_title,
    industry: row.industry,
    tier: row.tier,
    candidateName: row.candidate_name,
    candidateEmail: row.candidate_email,
  };
}
