import type { Milestone, Project, ProjectStage } from '@asteai/types';

export interface ProjectRow {
  id: string;
  buyer_id: string;
  tenant_id: string | null;
  title: string;
  domain: string | null;
  budget: string | number | null;
  stage: ProjectStage;
  description: string | null;
  milestones: Milestone[] | null;
  nda_required: boolean;
  awarded_to: string | null;
  rating: Project['rating'];
  packaged: boolean;
  created_at: Date | string;
  buyer_name?: string;
  /** Selected by the list and detail queries: the contract for the awarded proposal, if any. */
  contract_id?: string | null;
}

/** A project as the API returns it. `contractId` is undefined when the query didn't select it. */
export type ProjectResponse = Project & { buyerName?: string; contractId?: string | null };

export function mapProjectRow(row: ProjectRow): ProjectResponse {
  return {
    id: row.id,
    buyerId: row.buyer_id,
    tenantId: row.tenant_id ?? '',
    title: row.title,
    domain: row.domain ?? '',
    budget: row.budget === null ? 0 : Number(row.budget), // NUMERIC arrives as a string
    stage: row.stage,
    description: row.description ?? '',
    milestones: row.milestones ?? [],
    ndaRequired: row.nda_required,
    createdAt: new Date(row.created_at).getTime(),
    awardedTo: row.awarded_to,
    proposals: [],
    rating: row.rating ?? null,
    packaged: row.packaged,
    buyerName: row.buyer_name,
    ...(row.contract_id !== undefined && { contractId: row.contract_id }),
  };
}
