// Pure helpers for the contract UI. The payment-terms rules mirror paymentTermsError /
// paymentTermsTotal in packages/types/src/contract.ts (the API enforces them again).
import type { Contract, ContractMilestone, ContractStatus, EngagementModel } from './types';

export const ENGAGEMENT_MODEL_OPTIONS: { id: EngagementModel; label: string }[] = [
  { id: 'fixed', label: 'Fixed price' },
  { id: 'hourly', label: 'Hourly' },
  { id: 'daily', label: 'Daily' },
  { id: 'sprint', label: 'Sprint' },
];

export interface TermField { key: string; label: string; integer?: boolean }

export const TERM_FIELDS: Record<EngagementModel, TermField[]> = {
  fixed: [{ key: 'totalAmount', label: 'Total amount' }],
  hourly: [{ key: 'hourlyRate', label: 'Hourly rate' }, { key: 'estimatedHours', label: 'Estimated hours' }],
  daily: [{ key: 'dailyRate', label: 'Daily rate' }, { key: 'totalDays', label: 'Total days', integer: true }],
  sprint: [
    { key: 'sprintRate', label: 'Rate per sprint' },
    { key: 'sprintDurationDays', label: 'Sprint length (days)', integer: true },
    { key: 'totalSprints', label: 'Number of sprints', integer: true },
  ],
};

/** Money to integer paise, so sums compare exactly. */
export const toMinor = (amount: number) => Math.round(amount * 100);

export type ParsedTerms = { terms: Record<string, number>; error: null } | { terms: null; error: string };

/** Parsed terms from the form's string inputs, or an error message. */
export function parseTerms(model: EngagementModel, raw: Record<string, string>): ParsedTerms {
  const terms: Record<string, number> = {};
  for (const f of TERM_FIELDS[model]) {
    const text = raw[f.key]?.trim() ?? '';
    const value = Number(text);
    if (!text || !Number.isFinite(value) || value <= 0) return { terms: null, error: `${f.label} must be a positive number` };
    if (f.integer && !Number.isInteger(value)) return { terms: null, error: `${f.label} must be a whole number` };
    terms[f.key] = value;
  }
  return { terms, error: null };
}

/** The contract value the terms describe. */
export function termsTotal(model: EngagementModel, t: Record<string, number>): number {
  const total = {
    fixed: () => t.totalAmount,
    hourly: () => t.hourlyRate * t.estimatedHours,
    daily: () => t.dailyRate * t.totalDays,
    sprint: () => t.sprintRate * t.totalSprints,
  }[model]();
  return toMinor(total) / 100;
}

export interface MilestoneDraft { title: string; amount: string; dueDate: string }

/** Sum of the drafted milestone amounts, in paise (invalid amounts count as 0). */
export function draftSumMinor(drafts: MilestoneDraft[]): number {
  return drafts.reduce((acc, m) => {
    const n = Number(m.amount);
    return acc + (Number.isFinite(n) && n > 0 ? toMinor(n) : 0);
  }, 0);
}

/** Why the milestones cannot be submitted against `total`, or null. */
export function milestonesError(drafts: MilestoneDraft[], total: number): string | null {
  if (!drafts.length) return 'Add at least one milestone';
  if (drafts.length > 50) return 'At most 50 milestones';
  for (const [i, m] of drafts.entries()) {
    if (!m.title.trim()) return `Milestone ${i + 1} needs a title`;
    if (m.title.trim().length > 200) return `Milestone ${i + 1}: the title is too long`;
    const n = Number(m.amount);
    if (!m.amount.trim() || !Number.isFinite(n) || n <= 0) return `Milestone ${i + 1} needs a positive amount`;
    if (toMinor(n) / 100 !== n) return `Milestone ${i + 1}: at most 2 decimals`;
  }
  const diff = toMinor(total) - draftSumMinor(drafts);
  if (diff > 0) return `Milestones are ${formatMoney(diff / 100)} short of the total`;
  if (diff < 0) return `Milestones exceed the total by ${formatMoney(-diff / 100)}`;
  return null;
}

/** Splits `total` into `count` amounts that sum exactly (the remainder goes to the last). */
export function splitEvenly(total: number, count: number): number[] {
  if (count < 1) return [];
  const minor = toMinor(total);
  const each = Math.floor(minor / count);
  return Array.from({ length: count }, (_, i) => (i === count - 1 ? minor - each * (count - 1) : each) / 100);
}

export function formatMoney(amount: number, currency = 'INR'): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 2 }).format(amount);
  } catch {
    return `${currency} ${amount.toFixed(2)}`;
  }
}

export type Side = 'buyer' | 'expert' | 'admin' | null;

export function sideOf(
  contract: Pick<Contract, 'buyerId' | 'expertId'>,
  user: { id: string; role: string } | null | undefined,
): Side {
  if (!user) return null;
  if (user.id === contract.buyerId) return 'buyer';
  if (user.id === contract.expertId) return 'expert';
  return user.role === 'Admin' ? 'admin' : null;
}

export type MilestoneUiAction = 'fund' | 'submit' | 'request_revision' | 'accept' | 'release';

/** The actions `side` may take on a milestone (mirrors the API's MILESTONE_ACTIONS). */
export function milestoneUiActions(
  side: Side,
  contractStatus: ContractStatus,
  m: Pick<ContractMilestone, 'status' | 'paymentPending'>,
): MilestoneUiAction[] {
  if (contractStatus !== 'active') return [];
  if (side === 'expert') return m.status === 'funded' || m.status === 'revision_requested' ? ['submit'] : [];
  if (side !== 'buyer') return [];
  switch (m.status) {
    case 'pending': return m.paymentPending ? [] : ['fund'];
    case 'submitted': return ['accept', 'request_revision'];
    case 'accepted': return ['release'];
    default: return [];
  }
}

/** Whether `side` may cancel now (the API re-checks; the buyer only before money moves). */
export function canCancel(side: Side, c: Pick<Contract, 'status' | 'escrowFunded' | 'milestones'>): boolean {
  if (side === 'admin') return ['draft', 'pending_signature', 'active', 'disputed'].includes(c.status);
  if (side !== 'buyer') return false;
  return ['draft', 'pending_signature', 'active'].includes(c.status)
    && toMinor(c.escrowFunded) === 0
    && c.milestones.every((m) => m.status === 'pending' || m.status === 'cancelled');
}

export const STATUS_LABEL: Record<string, string> = {
  draft: 'Draft',
  pending_signature: 'Awaiting signatures',
  active: 'Active',
  completed: 'Completed',
  cancelled: 'Cancelled',
  disputed: 'Disputed',
  pending: 'Not funded',
  funded: 'Funded',
  submitted: 'Submitted',
  revision_requested: 'Revision requested',
  accepted: 'Accepted',
  released: 'Released',
};

export function statusColor(status: string): 'mint' | 'amber' | 'rose' | 'grey' | 'gold' {
  if (['active', 'released', 'completed', 'accepted'].includes(status)) return 'mint';
  if (['pending_signature', 'submitted', 'revision_requested'].includes(status)) return 'amber';
  if (status === 'cancelled' || status === 'disputed') return 'rose';
  if (status === 'funded') return 'gold';
  return 'grey';
}

/** Short human description of the terms. */
export function describeTerms(model: EngagementModel, terms: Record<string, number>, currency: string): string {
  const m = (n: number) => formatMoney(n, currency);
  switch (model) {
    case 'fixed': return `Fixed price, ${m(terms.totalAmount)}`;
    case 'hourly': return `${m(terms.hourlyRate)}/hour × ${terms.estimatedHours} estimated hours`;
    case 'daily': return `${m(terms.dailyRate)}/day × ${terms.totalDays} days`;
    case 'sprint': return `${m(terms.sprintRate)}/sprint × ${terms.totalSprints} sprints of ${terms.sprintDurationDays} days`;
    default: return '';
  }
}
