import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { allocateFifo, allocationsOf, InsufficientCreditsError, planRefund, type CreditLot } from './fifo';

const NOW = new Date('2026-11-13T12:00:00Z');
const day = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const lot = (id: string, remaining: number, createdDaysAgo: number, expiresInDays: number | null = null): CreditLot =>
  ({ id, remaining, createdAt: day(-createdDaysAgo), expiresAt: expiresInDays === null ? null : day(expiresInDays) });

describe('allocateFifo', () => {
  it('takes from the oldest lot first', () => {
    const lots = [lot('new', 50, 1), lot('old', 50, 10), lot('mid', 50, 5)];
    assert.deepEqual(allocateFifo(lots, 20, NOW), [{ lotId: 'old', amount: 20 }]);
  });

  it('spans lots in creation order when the oldest runs out', () => {
    const lots = [lot('c', 100, 1), lot('a', 5, 9), lot('b', 10, 4)];
    assert.deepEqual(allocateFifo(lots, 22, NOW), [
      { lotId: 'a', amount: 5 },
      { lotId: 'b', amount: 10 },
      { lotId: 'c', amount: 7 },
    ]);
  });

  it('uses every credit when the cost equals the balance', () => {
    const out = allocateFifo([lot('a', 3, 2), lot('b', 4, 1)], 7, NOW);
    assert.equal(out.reduce((s, a) => s + a.amount, 0), 7);
  });

  it('skips expired and empty lots', () => {
    const lots = [lot('expired', 100, 30, -1), lot('empty', 0, 20), lot('live', 10, 1, 5)];
    assert.deepEqual(allocateFifo(lots, 10, NOW), [{ lotId: 'live', amount: 10 }]);
  });

  it('breaks creation-time ties by id, so the order is stable', () => {
    const t = 3;
    assert.deepEqual(allocateFifo([lot('b', 5, t), lot('a', 5, t)], 6, NOW), [
      { lotId: 'a', amount: 5 },
      { lotId: 'b', amount: 1 },
    ]);
  });

  it('is all or nothing: throws when live lots cannot cover the cost', () => {
    const lots = [lot('a', 5, 2), lot('gone', 50, 9, -1)];
    assert.throws(() => allocateFifo(lots, 6, NOW), (err: unknown) =>
      err instanceof InsufficientCreditsError && err.required === 6 && err.available === 5);
  });

  it('rejects zero, negative and fractional costs', () => {
    for (const cost of [0, -3, 1.5]) assert.throws(() => allocateFifo([lot('a', 10, 1)], cost, NOW), RangeError);
  });

  it('does not mutate the lots it is given', () => {
    const lots = [lot('a', 5, 2), lot('b', 5, 1)];
    allocateFifo(lots, 7, NOW);
    assert.deepEqual(lots.map((l) => l.remaining), [5, 5]);
  });
});

describe('planRefund', () => {
  it('returns credits to lots that are still live', () => {
    const plan = planRefund([{ lotId: 'a', amount: 5 }, { lotId: 'b', amount: 3 }], new Map([['a', null], ['b', day(2)]]), NOW);
    assert.deepEqual(plan, { restore: [{ lotId: 'a', amount: 5 }, { lotId: 'b', amount: 3 }], reissue: 0 });
  });

  it('reissues the part whose lot has expired or is gone', () => {
    const plan = planRefund(
      [{ lotId: 'live', amount: 4 }, { lotId: 'expired', amount: 6 }, { lotId: 'gone', amount: 2 }],
      new Map([['live', day(1)], ['expired', day(-1)]]),
      NOW,
    );
    assert.deepEqual(plan, { restore: [{ lotId: 'live', amount: 4 }], reissue: 8 });
  });
});

describe('allocationsOf', () => {
  it('keeps only well-formed allocations', () => {
    assert.deepEqual(
      allocationsOf({ allocations: [{ lotId: 'a', amount: 2 }, { lotId: 1, amount: 2 }, { lotId: 'b', amount: -1 }, null] }),
      [{ lotId: 'a', amount: 2 }],
    );
    assert.deepEqual(allocationsOf(null), []);
    assert.deepEqual(allocationsOf({ allocations: 'x' }), []);
  });
});
