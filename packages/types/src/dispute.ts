// ─── Disputes ────────────────────────────────────────────────────────────────
// Shared by apps/api (modules/disputes) and apps/web (app/platform/disputes,
// features/disputes). Re-exported from ./index (`export * from './dispute'`).

export const DISPUTE_REASON_CODES = [
  'quality', 'scope', 'non_delivery', 'late', 'payment', 'communication', 'other',
] as const;
export type DisputeReasonCode = typeof DISPUTE_REASON_CODES[number];

export const DISPUTE_STATUSES = ['open', 'awaiting_response', 'under_review', 'resolved', 'withdrawn'] as const;
export type DisputeStatus = typeof DISPUTE_STATUSES[number];

/** Statuses in which a dispute is still open (it freezes its contract). */
export const OPEN_DISPUTE_STATUSES = ['open', 'awaiting_response', 'under_review'] as const satisfies readonly DisputeStatus[];

export const DISPUTE_RESOLUTIONS = ['release_to_expert', 'refund_to_buyer', 'split', 'no_action'] as const;
export type DisputeResolution = typeof DISPUTE_RESOLUTIONS[number];

/** Milestone statuses with escrow money at stake: a dispute may be raised on them. */
export const DISPUTABLE_MILESTONE_STATUSES = ['funded', 'submitted', 'revision_requested', 'accepted'] as const;

/** The respondent has this long to answer before the dispute goes to admin review. */
export const DISPUTE_RESPONSE_HOURS = 72;

export const DISPUTE_LIMITS = {
  description: 4000,
  message: 4000,
  evidenceLinks: 10,
  evidenceLinkLength: 2000,
} as const;

/** Whether `link` is an acceptable evidence link: an absolute https URL with a host. */
export function isEvidenceLink(link: string): boolean {
  if (typeof link !== 'string' || link.length > DISPUTE_LIMITS.evidenceLinkLength) return false;
  try {
    const url = new URL(link);
    return url.protocol === 'https:' && url.hostname.length > 0 && !url.username && !url.password;
  } catch {
    return false;
  }
}

export interface DisputeMessage {
  id: string;
  disputeId: string;
  authorId: string;
  authorName: string;
  /** 'admin' for platform staff. */
  authorSide: 'buyer' | 'expert' | 'admin';
  body: string;
  evidenceLinks: string[];
  /** Admin-only note; never returned to the parties. */
  internal: boolean;
  createdAt: string;
}

export interface DisputeSummary {
  id: string;
  contractId: string | null;
  milestoneId: string | null;
  milestoneTitle: string | null;
  projectId: string | null;
  projectTitle: string | null;
  raisedBy: string;
  raisedByName: string;
  againstUser: string;
  againstUserName: string;
  reasonCode: DisputeReasonCode;
  amountInDispute: number | null;
  currency: string;
  status: DisputeStatus;
  /** The respondent's deadline (raised + 72h). */
  respondBy: string;
  /** True while open past respondBy (the SLA sweep moves it to review). */
  overdue: boolean;
  resolution: DisputeResolution | null;
  resolvedAt: string | null;
  /** 'legacy_project' for disputes migrated from the old project-level table. */
  source: 'app' | 'legacy_project';
  createdAt: string;
  updatedAt: string;
}

export interface Dispute extends DisputeSummary {
  description: string;
  /** Escrow held on the disputed milestone(s) right now: what a resolution can move. */
  heldAmount: number;
  /** The buyer and expert of the contract. */
  buyerId: string | null;
  expertId: string | null;
  splitExpertAmount: number | null;
  splitBuyerAmount: number | null;
  resolutionNote: string | null;
  resolvedBy: string | null;
  escalatedAt: string | null;
  messages: DisputeMessage[];
}

/** POST /disputes */
export interface CreateDisputeInput {
  contractId: string;
  milestoneId?: string;
  reasonCode: DisputeReasonCode;
  description: string;
  amountInDispute?: number;
}

/** POST /disputes/:id/messages */
export interface DisputeMessageInput {
  body: string;
  evidenceLinks?: string[];
  /** Admins only: a note the parties never see. */
  internal?: boolean;
}

/** POST /disputes/:id/resolve (Admin) */
export interface ResolveDisputeInput {
  resolution: DisputeResolution;
  note: string;
  /** split only: both required and summing to the held amount. */
  splitExpertAmount?: number;
  splitBuyerAmount?: number;
}

/** POST /disputes/:id/resolve: the dispute, plus how the follow-up refund went (if any). */
export interface ResolveDisputeResult {
  dispute: Dispute;
  refund: { amount: number; status: 'requested' | 'failed' | 'none'; error?: string };
}
