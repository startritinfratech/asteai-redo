import type { WalletBalances } from './billing-types';

/**
 * Wallet arithmetic over ledger_entries, kept pure so it can be tested without a database.
 *
 * Ledger conventions (ContractsService / PayoutsService):
 *   'Escrow hold'    user = buyer,  payee = expert, amount < 0, ref = `<contract id>/<milestone id>`
 *   'Escrow release' user = expert, payee = expert, amount > 0, same ref as its hold
 *   'Refund'         user = whoever's balance it changes: > 0 money back to a buyer
 *                    (ref = `<contract id>/refund/<refund id>`); < 0 a clawback from an expert
 *   'Fee'            user = the user charged, amount < 0
 *   'Payout'         user = expert, amount < 0, ref = payout request id
 *
 * Escrow is netted per ref: what is still held for a milestone is its hold minus the
 * release with the same ref. A hold whose milestone is settled (cancelled, or released, which
 * a split dispute does with only part of the hold paid out) is no longer "in escrow" for
 * anyone: what is left of it is owed back to the buyer (contracts.refund_due), less the
 * refunds already paid on that contract. Amounts are summed in paise so totals are exact.
 */

/** One `GROUP BY type, ref, user_id, payee_id` row of ledger_entries. */
export interface WalletLedgerGroup {
  type: string;
  ref: string | null;
  userId: string | null;
  payeeId: string | null;
  total: number;
}

export interface WalletInputs {
  groups: WalletLedgerGroup[];
  /** Refs (`<contract id>/<milestone id>`) of holds whose milestone is cancelled or released. */
  settledRefs: ReadonlySet<string>;
  /** Sum of the user's payout requests that are requested or approved. */
  payoutsPending: number;
}

const minor = (amount: number) => Math.round(amount * 100);
const major = (paise: number) => paise / 100;

/** The contract ids behind escrow refs, for the settled-milestone lookup. */
export function contractIdsOfRefs(refs: Iterable<string | null>): string[] {
  const ids = new Set<string>();
  for (const ref of refs) {
    const [contractId, milestoneId] = (ref ?? '').split('/');
    if (contractId && milestoneId) ids.add(contractId);
  }
  return [...ids];
}

export function computeWallet(userId: string, { groups, settledRefs, payoutsPending }: WalletInputs): WalletBalances {
  const releasedByRef = new Map<string, number>();
  const refundedByContract = new Map<string, number>();
  const add = (map: Map<string, number>, key: string, v: number) => map.set(key, (map.get(key) ?? 0) + v);

  let earned = 0;
  let fees = 0;
  let paidOut = 0;
  let refunded = 0;

  for (const g of groups) {
    const amount = minor(g.total);
    const mine = g.userId === userId;
    switch (g.type) {
      case 'Escrow release':
        if (g.ref) add(releasedByRef, g.ref, amount);
        if (mine) earned += amount;
        break;
      case 'Refund':
        if (amount > 0) {
          if (mine) {
            refunded += amount;
            const contractId = (g.ref ?? '').split('/')[0];
            if (contractId) add(refundedByContract, contractId, amount);
          }
        } else if (mine) {
          earned += amount; // clawback from an expert
        }
        break;
      case 'Fee':
        if (mine) fees += Math.abs(amount);
        break;
      case 'Payout':
        if (mine) paidOut += Math.abs(amount);
        break;
      default:
        break;
    }
  }

  let funded = 0;
  let released = 0;
  let buyerHeld = 0;
  let expertHeld = 0;
  const settledByContract = new Map<string, number>();

  for (const g of groups) {
    if (g.type !== 'Escrow hold') continue;
    const held = Math.abs(minor(g.total));
    const rel = g.ref ? Math.min(held, releasedByRef.get(g.ref) ?? 0) : 0;
    const remaining = held - rel;
    const settled = g.ref != null && settledRefs.has(g.ref);

    if (g.userId === userId) {
      funded += held;
      released += rel;
      if (settled) add(settledByContract, (g.ref ?? '').split('/')[0], remaining);
      else buyerHeld += remaining;
    }
    if (g.payeeId === userId && !settled) expertHeld += remaining;
  }

  let refundDue = 0;
  for (const [contractId, owed] of settledByContract) {
    refundDue += Math.max(0, owed - (refundedByContract.get(contractId) ?? 0));
  }

  const pending = minor(payoutsPending);
  const available = Math.max(0, earned - fees - paidOut - pending);

  return {
    currency: 'INR',
    earned: major(earned),
    fees: major(fees),
    pending: major(expertHeld + buyerHeld),
    expert: {
      earned: major(earned),
      fees: major(fees),
      paidOut: major(paidOut),
      payoutsPending: major(pending),
      available: major(available),
      inEscrow: major(expertHeld),
    },
    buyer: {
      funded: major(funded),
      released: major(released),
      refunded: major(refunded),
      inEscrow: major(buyerHeld),
      refundDue: major(refundDue),
    },
  };
}
