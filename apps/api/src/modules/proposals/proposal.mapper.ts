import type { ProjectStage, Proposal, ProposalStatus } from '@asteai/types';

export interface ProposalRow {
  id: string;
  project_id: string;
  expert_id: string;
  price: string | number; // NUMERIC arrives as a string
  days: number;
  note: string | null;
  status: ProposalStatus;
  created_at: Date | string;
  updated_at: Date | string;
  // joined by some queries
  expert_name?: string;
  project_title?: string;
  project_stage?: ProjectStage;
  contract_id?: string | null;
}

/** A proposal as the API returns it. Joined fields appear only when the query selected them. */
export function mapProposalRow(row: ProposalRow): Proposal {
  return {
    id: row.id,
    projectId: row.project_id,
    expertId: row.expert_id,
    price: Number(row.price),
    days: Number(row.days),
    note: row.note ?? '',
    status: row.status,
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
    ...(row.expert_name !== undefined && { expertName: row.expert_name }),
    ...(row.project_title !== undefined && { projectTitle: row.project_title }),
    ...(row.project_stage !== undefined && { projectStage: row.project_stage }),
    ...(row.contract_id !== undefined && { contractId: row.contract_id }),
  };
}
