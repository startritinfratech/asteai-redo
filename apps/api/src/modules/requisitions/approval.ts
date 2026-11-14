/**
 * Requisition approval rules, pure so they are unit-tested (approval.spec.ts).
 *
 * draft ──submit / make public──▶ pending ──admin approve──▶ approved ──▶ listed (if public & Open)
 *                                    │                        │
 *                                    └──admin reject──▶ rejected ──fix & resubmit──▶ pending
 * Editing anything a job seeker sees on an approved requisition sends it back to pending,
 * so an approved posting can't be swapped for unreviewed content.
 */
import type { ReqApprovalStatus, Requisition } from '@asteai/types';

/** Fields shown on the public job board or to applicants. */
export const PUBLIC_FIELDS = [
  'title', 'industry', 'func', 'location', 'brief', 'stack', 'screeningQuestions',
  'employmentType', 'locationType', 'salaryMin', 'salaryMax', 'salaryCurrency', 'requirements',
] as const;
type PublicField = (typeof PUBLIC_FIELDS)[number];

const same = (a: unknown, b: unknown) => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

function currentValue(r: Requisition, f: PublicField): unknown {
  switch (f) {
    case 'employmentType': return r.posting?.employmentType;
    case 'locationType': return r.posting?.locationType;
    case 'salaryMin': return r.posting?.salaryMin;
    case 'salaryMax': return r.posting?.salaryMax;
    case 'salaryCurrency': return r.posting?.salaryCurrency;
    case 'requirements': return r.posting?.requirements;
    default: return r[f];
  }
}

/** Which public-facing fields `patch` actually changes (fields it omits don't count). */
export function changedPublicFields(existing: Requisition, patch: Partial<Record<PublicField, unknown>>): PublicField[] {
  return PUBLIC_FIELDS.filter((f) => patch[f] !== undefined && !same(patch[f], currentValue(existing, f)));
}

/** The approval status after an owner's edit. */
export function approvalAfterEdit(status: ReqApprovalStatus, publicChanges: number, makingPublic: boolean): ReqApprovalStatus {
  if (status === 'approved') return publicChanges > 0 ? 'pending' : 'approved';
  if (status === 'pending') return 'pending';
  // draft / rejected: turning the posting on asks for review.
  return makingPublic ? 'pending' : status;
}

/** Owners may submit a draft or a rejected requisition; pending/approved need nothing. */
export function canSubmitForApproval(status: ReqApprovalStatus): boolean {
  return status === 'draft' || status === 'rejected';
}

/** A rubric's weights must be whole numbers summing to exactly 100 (an empty rubric is fine). */
export function rubricWeightsValid(rubric: readonly { weight: number }[] | undefined): boolean {
  if (!rubric?.length) return true;
  return rubric.every((c) => Number.isInteger(c.weight) && c.weight > 0) && rubric.reduce((s, c) => s + c.weight, 0) === 100;
}
