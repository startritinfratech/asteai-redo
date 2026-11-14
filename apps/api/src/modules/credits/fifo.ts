/**
 * Credit arithmetic, kept pure so it is tested without a database (fifo.spec.ts).
 * CreditsService runs it on rows it has locked FOR UPDATE.
 */

export interface CreditLot {
  id: string;
  remaining: number;
  expiresAt: Date | null;
  createdAt: Date;
}

export interface Allocation {
  lotId: string;
  amount: number;
}

export class InsufficientCreditsError extends Error {
  constructor(readonly required: number, readonly available: number) {
    super(`Not enough credits: ${required} needed, ${available} available`);
    this.name = 'InsufficientCreditsError';
  }
}

const isLive = (lot: CreditLot, now: Date) => lot.remaining > 0 && (!lot.expiresAt || lot.expiresAt > now);

/**
 * FIFO: draws `cost` from the oldest live lots first (created_at, then id, so the order is
 * total). Expired and empty lots are skipped. All or nothing: throws when the live lots
 * cannot cover the whole cost.
 */
export function allocateFifo(lots: readonly CreditLot[], cost: number, now = new Date()): Allocation[] {
  if (!Number.isInteger(cost) || cost <= 0) throw new RangeError(`cost must be a positive integer, got ${cost}`);
  const live = lots
    .filter((l) => isLive(l, now))
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));

  const available = live.reduce((sum, l) => sum + l.remaining, 0);
  if (available < cost) throw new InsufficientCreditsError(cost, available);

  const out: Allocation[] = [];
  let left = cost;
  for (const lot of live) {
    if (left === 0) break;
    const take = Math.min(lot.remaining, left);
    out.push({ lotId: lot.id, amount: take });
    left -= take;
  }
  return out;
}

export interface RefundPlan {
  /** Credits going back into the lots they came from (still live). */
  restore: Allocation[];
  /** Credits whose lot expired since the spend: they go into a new refund lot instead. */
  reissue: number;
}

/**
 * Where a refunded spend's credits go: back to their original lots while those are still
 * live (so expiry dates are kept), otherwise into a fresh short-lived lot, so a failed AI
 * task never costs the user credits even if a lot expired meanwhile.
 */
export function planRefund(
  allocations: readonly Allocation[],
  lotExpiry: ReadonlyMap<string, Date | null>,
  now = new Date(),
): RefundPlan {
  const restore: Allocation[] = [];
  let reissue = 0;
  for (const a of allocations) {
    if (!lotExpiry.has(a.lotId)) {
      reissue += a.amount;
      continue;
    }
    const exp = lotExpiry.get(a.lotId) ?? null;
    if (!exp || exp > now) restore.push(a);
    else reissue += a.amount;
  }
  return { restore, reissue };
}

/** Parses `metadata.allocations` from a spend row, dropping anything malformed. */
export function allocationsOf(metadata: unknown): Allocation[] {
  const list = (metadata as { allocations?: unknown } | null)?.allocations;
  if (!Array.isArray(list)) return [];
  return list.filter((a): a is Allocation =>
    !!a && typeof (a as Allocation).lotId === 'string'
    && Number.isInteger((a as Allocation).amount) && (a as Allocation).amount > 0);
}
