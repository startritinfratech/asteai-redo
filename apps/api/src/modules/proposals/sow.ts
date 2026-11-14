/** Statement-of-work rules, pure for tests (sow.spec.ts). */
import type { CreateContractInput, StatementOfWork } from '@asteai/types';

const cents = (n: number) => Math.round(n * 100);

/** Problems with a SOW for a bid of `price` over `days`; empty when it's consistent. */
export function sowErrors(sow: StatementOfWork, price: number, days: number): string[] {
  const errors: string[] = [];
  if (!sow.milestones.length) errors.push('Add at least one milestone');
  const total = sow.milestones.reduce((s, m) => s + cents(m.amount), 0);
  if (sow.milestones.length && total !== cents(price)) {
    errors.push(`Milestone amounts add up to ${(total / 100).toFixed(2)}, not the bid price ${price.toFixed(2)}`);
  }
  const late = sow.milestones.filter((m) => m.dueInDays > days);
  if (late.length) errors.push(`Milestones due after the ${days}-day timeline: ${late.map((m) => m.title).join(', ')}`);
  for (let i = 1; i < sow.milestones.length; i++) {
    if (sow.milestones[i].dueInDays < sow.milestones[i - 1].dueInDays) {
      errors.push('List milestones in the order they are due');
      break;
    }
  }
  return errors;
}

const ymd = (d: Date) => d.toISOString().slice(0, 10);

/**
 * The POST /contracts body a buyer gets from an awarded SOW: a fixed-price contract whose
 * escrow milestones are the SOW's, due `dueInDays` after `start`. Acceptance criteria and
 * scope stay on the proposal (the contract references it by proposalId).
 */
export function contractDraftFromSow(
  proposal: { id: string; price: number; sow: StatementOfWork }, start: Date, currency = 'INR',
): CreateContractInput {
  return {
    proposalId: proposal.id,
    engagementModel: 'fixed',
    paymentTerms: { totalAmount: proposal.price },
    currency,
    milestones: proposal.sow.milestones.map((m) => ({
      title: m.title,
      amount: m.amount,
      dueDate: ymd(new Date(start.getTime() + m.dueInDays * 86_400_000)),
    })),
    ndaRequired: false,
  };
}
