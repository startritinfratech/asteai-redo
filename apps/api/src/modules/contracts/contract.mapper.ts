import type {
  Contract, ContractMilestone, ContractMilestoneStatus, ContractStatus, ContractSummary, EngagementModel, PaymentTerms,
} from './contract.types';

type Num = string | number; // NUMERIC arrives as a string
type Ts = Date | string | null;

export interface ContractRow {
  id: string;
  project_id: string | null;
  proposal_id: string | null;
  gig_order_id?: string | null;
  title?: string | null;
  tenant_id: string | null;
  buyer_id: string;
  expert_id: string;
  engagement_model: EngagementModel;
  payment_terms: PaymentTerms;
  currency: string;
  total_amount: Num;
  escrow_funded: Num;
  released: Num;
  status: ContractStatus;
  nda_required: boolean;
  nda_text: string | null;
  buyer_signed_at: Ts;
  expert_signed_at: Ts;
  buyer_signature: string | null;
  expert_signature: string | null;
  cancelled_by: string | null;
  cancel_reason: string | null;
  refund_due: Num;
  source: string;
  created_at: Ts;
  updated_at: Ts;
  // joined
  project_title?: string | null;
  display_title?: string | null;
  buyer_name?: string;
  expert_name?: string;
}

export interface MilestoneRow {
  id: string;
  contract_id: string;
  seq: number;
  title: string;
  amount: Num;
  due_date: Date | string | null;
  status: ContractMilestoneStatus;
  funded_at: Ts;
  submitted_at: Ts;
  accepted_at: Ts;
  released_at: Ts;
  revision_count: number;
  submission_note: string | null;
  revision_note: string | null;
  payment_pending?: boolean;
}

export interface PaymentRow {
  id: string;
  contract_id: string;
  milestone_id: string;
  amount: Num;
  currency: string;
  provider: string;
  provider_payment_id: string | null;
  status: 'pending' | 'captured' | 'failed';
}

function iso(value: Ts): string | null {
  return value == null ? null : new Date(value).toISOString();
}

/** DATE columns: pg parses them as local midnight, so read the local calendar fields. */
export function dateOnly(value: Date | string | null): string | null {
  if (value == null) return null;
  if (typeof value === 'string') return value.slice(0, 10);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}

export function mapMilestoneRow(row: MilestoneRow): ContractMilestone {
  return {
    id: row.id,
    seq: Number(row.seq),
    title: row.title,
    amount: Number(row.amount),
    dueDate: dateOnly(row.due_date),
    status: row.status,
    fundedAt: iso(row.funded_at),
    submittedAt: iso(row.submitted_at),
    acceptedAt: iso(row.accepted_at),
    releasedAt: iso(row.released_at),
    revisionCount: Number(row.revision_count ?? 0),
    submissionNote: row.submission_note,
    revisionNote: row.revision_note,
    paymentPending: Boolean(row.payment_pending),
  };
}

export function mapContractSummary(row: ContractRow): ContractSummary {
  return {
    id: row.id,
    projectId: row.project_id ?? null,
    projectTitle: row.project_title ?? null,
    title: row.display_title ?? row.title ?? row.project_title ?? row.id,
    proposalId: row.proposal_id ?? null,
    gigOrderId: row.gig_order_id ?? null,
    buyerId: row.buyer_id,
    buyerName: row.buyer_name ?? '',
    expertId: row.expert_id,
    expertName: row.expert_name ?? '',
    engagementModel: row.engagement_model,
    currency: row.currency,
    totalAmount: Number(row.total_amount),
    escrowFunded: Number(row.escrow_funded),
    released: Number(row.released),
    status: row.status,
    createdAt: iso(row.created_at) ?? '',
    updatedAt: iso(row.updated_at) ?? '',
  };
}

export function mapContractRow(row: ContractRow, milestones: MilestoneRow[]): Contract {
  return {
    ...mapContractSummary(row),
    paymentTerms: row.payment_terms,
    ndaRequired: row.nda_required,
    ndaText: row.nda_text,
    buyerSignedAt: iso(row.buyer_signed_at),
    expertSignedAt: iso(row.expert_signed_at),
    buyerSignature: row.buyer_signature,
    expertSignature: row.expert_signature,
    cancelledBy: row.cancelled_by,
    cancelReason: row.cancel_reason,
    refundDue: Number(row.refund_due ?? 0),
    source: row.source,
    milestones: milestones.map(mapMilestoneRow),
  };
}
