import type { ContractMilestoneStatus, ContractStatus } from './contract.types';

/** Who is asking, relative to one contract. */
export interface ContractParty {
  isAdmin: boolean;
  isBuyer: boolean;
  isExpert: boolean;
}

export function partyOf(contract: { buyer_id: string; expert_id: string }, user: { id: string; role: string }): ContractParty {
  return {
    isAdmin: user.role === 'Admin',
    isBuyer: contract.buyer_id === user.id,
    isExpert: contract.expert_id === user.id,
  };
}

/**
 * Milestone moves after funding. Funding itself (pending → funded) is not a user move:
 * the buyer only opens a payment request, and the milestone becomes 'funded' when that
 * payment is captured (see ContractsService.markPaymentCaptured).
 */
export const MILESTONE_ACTIONS = {
  submit: { by: 'expert', from: ['funded', 'revision_requested'], to: 'submitted' },
  request_revision: { by: 'buyer', from: ['submitted'], to: 'revision_requested' },
  accept: { by: 'buyer', from: ['submitted'], to: 'accepted' },
  release: { by: 'buyer', from: ['accepted'], to: 'released' },
} as const satisfies Record<string, {
  by: 'buyer' | 'expert'; from: readonly ContractMilestoneStatus[]; to: ContractMilestoneStatus;
}>;
export type MilestoneAction = keyof typeof MILESTONE_ACTIONS;

/** Whether `party` is the side that makes `action`. Admins make no milestone moves. */
export function isActor(party: ContractParty, action: MilestoneAction): boolean {
  return MILESTONE_ACTIONS[action].by === 'buyer' ? party.isBuyer : party.isExpert;
}

/** Whether `action` applies to a milestone currently in `status`. */
export function canApply(action: MilestoneAction, status: ContractMilestoneStatus): boolean {
  return (MILESTONE_ACTIONS[action].from as readonly ContractMilestoneStatus[]).includes(status);
}

/** Statuses a contract may still be cancelled from. */
export const CANCELLABLE: readonly ContractStatus[] = ['draft', 'pending_signature', 'active', 'disputed'];
/** The buyer may cancel on their own only before money is involved and the contract is running. */
export const BUYER_CANCELLABLE: readonly ContractStatus[] = ['draft', 'pending_signature', 'active'];

/** Signature names compare case-insensitively with whitespace collapsed. */
export function normaliseName(name: string): string {
  return name.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
