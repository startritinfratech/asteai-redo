import type {
  Dispute, DisputeMessage, DisputeReasonCode, DisputeResolution, DisputeStatus, DisputeSummary,
} from '@asteai/types';

export interface DisputeRow {
  id: string;
  contract_id: string | null;
  milestone_id: string | null;
  project_id: string | null;
  raised_by: string;
  against_user: string;
  reason_code: DisputeReasonCode;
  description: string;
  amount_in_dispute: string | number | null;
  status: DisputeStatus;
  respond_by: Date | string;
  resolution: DisputeResolution | null;
  split_expert_amount: string | number | null;
  split_buyer_amount: string | number | null;
  resolution_note: string | null;
  resolved_by: string | null;
  resolved_at: Date | string | null;
  previous_contract_status: string | null;
  escalated_at: Date | string | null;
  source: 'app' | 'legacy_project';
  created_at: Date | string;
  updated_at: Date | string;
  // Joined by the list/detail queries.
  project_title?: string | null;
  milestone_title?: string | null;
  currency?: string | null;
  buyer_id?: string | null;
  expert_id?: string | null;
  raised_by_name?: string | null;
  against_user_name?: string | null;
}

export interface DisputeMessageRow {
  id: string;
  dispute_id: string;
  author_id: string;
  author_name: string | null;
  author_role: string | null;
  body: string;
  evidence_links: string[] | null;
  is_internal: boolean;
  created_at: Date | string;
}

const iso = (v: Date | string) => new Date(v).toISOString();
const isoOrNull = (v: Date | string | null) => (v ? iso(v) : null);
const num = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));

/** Open (not yet answered) and past the respondent's deadline. */
export function isOverdue(row: Pick<DisputeRow, 'status' | 'respond_by'>, now = Date.now()): boolean {
  return row.status === 'open' && new Date(row.respond_by).getTime() < now;
}

export function mapDisputeSummary(r: DisputeRow): DisputeSummary {
  return {
    id: r.id,
    contractId: r.contract_id,
    milestoneId: r.milestone_id,
    milestoneTitle: r.milestone_title ?? null,
    projectId: r.project_id,
    projectTitle: r.project_title ?? null,
    raisedBy: r.raised_by,
    raisedByName: r.raised_by_name?.trim() || 'Unknown',
    againstUser: r.against_user,
    againstUserName: r.against_user_name?.trim() || 'Unknown',
    reasonCode: r.reason_code,
    amountInDispute: num(r.amount_in_dispute),
    currency: r.currency ?? 'INR',
    status: r.status,
    respondBy: iso(r.respond_by),
    overdue: isOverdue(r),
    resolution: r.resolution,
    resolvedAt: isoOrNull(r.resolved_at),
    source: r.source,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export function mapDisputeMessage(
  r: DisputeMessageRow, parties: { buyerId: string | null; expertId: string | null },
): DisputeMessage {
  const authorSide = r.author_id === parties.buyerId ? 'buyer' : r.author_id === parties.expertId ? 'expert' : 'admin';
  return {
    id: r.id,
    disputeId: r.dispute_id,
    authorId: r.author_id,
    authorName: r.author_name?.trim() || (authorSide === 'admin' ? 'AsteAI team' : 'Unknown'),
    authorSide,
    body: r.body,
    evidenceLinks: r.evidence_links ?? [],
    internal: r.is_internal,
    createdAt: iso(r.created_at),
  };
}

export function mapDispute(r: DisputeRow, messages: DisputeMessage[], heldAmount: number): Dispute {
  return {
    ...mapDisputeSummary(r),
    description: r.description,
    heldAmount,
    buyerId: r.buyer_id ?? null,
    expertId: r.expert_id ?? null,
    splitExpertAmount: num(r.split_expert_amount),
    splitBuyerAmount: num(r.split_buyer_amount),
    resolutionNote: r.resolution_note,
    resolvedBy: r.resolved_by,
    escalatedAt: isoOrNull(r.escalated_at),
    messages,
  };
}
