// ─── Contracts ───────────────────────────────────────────────────────────────
// Shared by apps/api (modules/contracts) and apps/web (features/contracts).
// Types, the const arrays the API validates against, and the pure payment-terms rules.
// Re-exported from ./index, so import it from '@asteai/types'.

export const ENGAGEMENT_MODELS = ['fixed', 'hourly', 'daily', 'sprint'] as const;
export type EngagementModel = typeof ENGAGEMENT_MODELS[number];

export const CONTRACT_STATUSES = [
  'draft', 'pending_signature', 'active', 'completed', 'cancelled', 'disputed',
] as const;
export type ContractStatus = typeof CONTRACT_STATUSES[number];

export const CONTRACT_MILESTONE_STATUSES = [
  'pending', 'funded', 'submitted', 'revision_requested', 'accepted', 'released', 'cancelled',
] as const;
export type ContractMilestoneStatus = typeof CONTRACT_MILESTONE_STATUSES[number];

export const ESCROW_PAYMENT_STATUSES = ['pending', 'captured', 'failed'] as const;
export type EscrowPaymentStatus = typeof ESCROW_PAYMENT_STATUSES[number];

/** Payment terms, one shape per engagement model. Amounts are in the contract currency. */
export interface FixedTerms { totalAmount: number }
export interface HourlyTerms { hourlyRate: number; estimatedHours: number }
export interface DailyTerms { dailyRate: number; totalDays: number }
export interface SprintTerms { sprintRate: number; sprintDurationDays: number; totalSprints: number }
export type PaymentTerms = FixedTerms | HourlyTerms | DailyTerms | SprintTerms;

/** The numeric fields each model's terms must carry (all must be finite and > 0). */
export const PAYMENT_TERM_FIELDS: Record<EngagementModel, readonly string[]> = {
  fixed: ['totalAmount'],
  hourly: ['hourlyRate', 'estimatedHours'],
  daily: ['dailyRate', 'totalDays'],
  sprint: ['sprintRate', 'sprintDurationDays', 'totalSprints'],
};

/** Integer fields: you can't contract 2.5 sprints or 3.7 days. */
const INTEGER_TERM_FIELDS = new Set(['totalDays', 'sprintDurationDays', 'totalSprints']);

/** Money to integer paise/cents, so sums compare exactly. */
export function toMinor(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Why `terms` are not valid for `model`, or null when they are. Every required field
 * must be a positive finite number (whole numbers for day/sprint counts) and no
 * unknown fields are allowed.
 */
export function paymentTermsError(model: EngagementModel, terms: unknown): string | null {
  const fields = PAYMENT_TERM_FIELDS[model];
  if (!fields) return `Unknown engagement model '${String(model)}'`;
  if (typeof terms !== 'object' || terms === null || Array.isArray(terms)) return 'Payment terms must be an object';
  const record = terms as Record<string, unknown>;
  const extra = Object.keys(record).filter((k) => !fields.includes(k));
  if (extra.length) return `Unexpected payment term(s) for a ${model} contract: ${extra.join(', ')}`;
  for (const field of fields) {
    const value = record[field];
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
      return `${field} must be a positive number`;
    }
    if (INTEGER_TERM_FIELDS.has(field) && !Number.isInteger(value)) return `${field} must be a whole number`;
    if (value > 1e10) return `${field} is too large`;
  }
  return null;
}

/** The contract value the terms describe (rounded to 2 decimals). Assumes valid terms. */
export function paymentTermsTotal(model: EngagementModel, terms: PaymentTerms): number {
  const t = terms as unknown as Record<string, number>;
  let total: number;
  switch (model) {
    case 'fixed': total = t.totalAmount; break;
    case 'hourly': total = t.hourlyRate * t.estimatedHours; break;
    case 'daily': total = t.dailyRate * t.totalDays; break;
    case 'sprint': total = t.sprintRate * t.totalSprints; break;
    default: total = NaN;
  }
  return toMinor(total) / 100;
}

export interface ContractMilestone {
  id: string;
  seq: number;
  title: string;
  amount: number;
  dueDate: string | null; // YYYY-MM-DD
  status: ContractMilestoneStatus;
  submittedAt: string | null;
  acceptedAt: string | null;
  releasedAt: string | null;
  fundedAt: string | null;
  revisionCount: number;
  submissionNote: string | null;
  revisionNote: string | null;
  /** A fund request is waiting for the payment provider to confirm. */
  paymentPending: boolean;
}

/** A contract as listed by GET /contracts. */
export interface ContractSummary {
  id: string;
  projectId: string;
  projectTitle: string;
  proposalId: string;
  buyerId: string;
  buyerName: string;
  expertId: string;
  expertName: string;
  engagementModel: EngagementModel;
  currency: string;
  totalAmount: number;
  escrowFunded: number;
  released: number;
  status: ContractStatus;
  createdAt: string;
  updatedAt: string;
}

/** GET /contracts/:id. */
export interface Contract extends ContractSummary {
  paymentTerms: PaymentTerms;
  ndaRequired: boolean;
  ndaText: string | null;
  buyerSignedAt: string | null;
  expertSignedAt: string | null;
  buyerSignature: string | null;
  expertSignature: string | null;
  cancelledBy: string | null;
  cancelReason: string | null;
  /** 'app' for contracts created here, 'legacy_project' for ones copied from projects.milestones. */
  source: string;
  milestones: ContractMilestone[];
}

/** POST /contracts body. */
export interface CreateContractInput {
  proposalId: string;
  engagementModel: EngagementModel;
  paymentTerms: PaymentTerms;
  currency?: string;
  milestones: Array<{ title: string; amount: number; dueDate?: string }>;
  ndaRequired: boolean;
  ndaText?: string;
}

/** POST /contracts/:id/milestones/:mid/fund. The milestone is NOT funded until the provider confirms. */
export interface FundMilestoneResult {
  paymentId: string;
  amount: number;
  provider: string;
  status: EscrowPaymentStatus;
}

/** POST /contracts/admin/payments/:paymentId/capture. */
export interface CapturePaymentResult {
  paymentId: string;
  milestoneId: string;
  contractId: string;
  amount: number;
  alreadyCaptured: boolean;
}
