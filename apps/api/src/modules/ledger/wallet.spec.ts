import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Pool } from 'pg';
import { LedgerService } from './ledger.service';
import { computeWallet, contractIdsOfRefs, type WalletLedgerGroup } from './wallet';

const BUYER = 'buyer-1';
const EXPERT = 'exp-1';
const M1 = 'CT-1/m-1';
const M2 = 'CT-1/m-2';
const M3 = 'CT-2/m-3';

const hold = (ref: string | null, amount: number, buyer = BUYER, expert = EXPERT): WalletLedgerGroup =>
  ({ type: 'Escrow hold', ref, userId: buyer, payeeId: expert, total: -amount });
const release = (ref: string | null, amount: number, expert = EXPERT): WalletLedgerGroup =>
  ({ type: 'Escrow release', ref, userId: expert, payeeId: expert, total: amount });
const payout = (id: string, amount: number): WalletLedgerGroup =>
  ({ type: 'Payout', ref: id, userId: EXPERT, payeeId: EXPERT, total: -amount });
const refund = (ref: string, amount: number): WalletLedgerGroup =>
  ({ type: 'Refund', ref, userId: BUYER, payeeId: BUYER, total: amount });

const none = new Set<string>();

describe('computeWallet (expert)', () => {
  it('nets each hold against the release with the same ref', () => {
    const groups = [hold(M1, 400), hold(M2, 600), release(M1, 400)];
    const w = computeWallet(EXPERT, { groups, settledRefs: none, payoutsPending: 0 });
    assert.equal(w.expert.inEscrow, 600);
    assert.equal(w.expert.earned, 400);
    assert.equal(w.expert.available, 400);
    assert.equal(w.pending, 600);
    assert.equal(w.earned, 400);
  });

  it('no longer counts every hold as pending once it is released', () => {
    const groups = [hold(M1, 400), hold(M2, 600), release(M1, 400), release(M2, 600)];
    const w = computeWallet(EXPERT, { groups, settledRefs: none, payoutsPending: 0 });
    assert.equal(w.expert.inEscrow, 0);
    assert.equal(w.expert.earned, 1000);
  });

  it('subtracts paid payouts, pending payout requests and fees from what is available', () => {
    const groups = [
      hold(M1, 1000), release(M1, 1000), hold(M3, 250.5), release(M3, 250.5),
      payout('PO-1', 300), { type: 'Fee', ref: null, userId: EXPERT, payeeId: null, total: -50.25 },
    ];
    const w = computeWallet(EXPERT, { groups, settledRefs: none, payoutsPending: 200 });
    assert.equal(w.expert.earned, 1250.5);
    assert.equal(w.expert.paidOut, 300);
    assert.equal(w.expert.fees, 50.25);
    assert.equal(w.expert.payoutsPending, 200);
    assert.equal(w.expert.available, 700.25);
  });

  it('never reports a negative available balance', () => {
    const w = computeWallet(EXPERT, { groups: [release(M1, 100), payout('PO-1', 100)], settledRefs: none, payoutsPending: 50 });
    assert.equal(w.expert.available, 0);
  });

  it('applies refund adjustments (clawbacks) to earnings', () => {
    const clawback: WalletLedgerGroup = { type: 'Refund', ref: 'CT-1/refund/r1', userId: EXPERT, payeeId: EXPERT, total: -100 };
    const w = computeWallet(EXPERT, { groups: [release(M1, 400), clawback], settledRefs: none, payoutsPending: 0 });
    assert.equal(w.expert.earned, 300);
  });

  it('drops holds of cancelled milestones from the expert escrow', () => {
    const w = computeWallet(EXPERT, { groups: [hold(M1, 400), hold(M2, 600)], settledRefs: new Set([M2]), payoutsPending: 0 });
    assert.equal(w.expert.inEscrow, 400);
  });

  it('ignores rows of other users', () => {
    const groups = [hold(M1, 400, BUYER, 'someone-else'), release(M1, 400, 'someone-else')];
    const w = computeWallet(EXPERT, { groups, settledRefs: none, payoutsPending: 0 });
    assert.equal(w.expert.inEscrow, 0);
    assert.equal(w.expert.earned, 0);
  });
});

describe('computeWallet (buyer)', () => {
  it('reports funded, released and still-held escrow', () => {
    const groups = [hold(M1, 400), hold(M2, 600), release(M1, 400)];
    const w = computeWallet(BUYER, { groups, settledRefs: none, payoutsPending: 0 });
    assert.deepEqual(w.buyer, { funded: 1000, released: 400, refunded: 0, inEscrow: 600, refundDue: 0 });
    assert.equal(w.expert.earned, 0);
    assert.equal(w.pending, 600);
  });

  it('moves cancelled holds to refund due, less refunds already paid on that contract', () => {
    const groups = [hold(M1, 400), hold(M2, 600), release(M1, 400), refund('CT-1/refund/r1', 250)];
    const w = computeWallet(BUYER, { groups, settledRefs: new Set([M2]), payoutsPending: 0 });
    assert.equal(w.buyer.inEscrow, 0);
    assert.equal(w.buyer.refunded, 250);
    assert.equal(w.buyer.refundDue, 350);
    const settled = computeWallet(BUYER, {
      groups: [...groups, refund('CT-1/refund/r2', 350)], settledRefs: new Set([M2]), payoutsPending: 0,
    });
    assert.equal(settled.buyer.refundDue, 0);
    assert.equal(settled.buyer.refunded, 600);
  });

  it('a split-released milestone: the unreleased remainder is owed back to the buyer, in escrow for nobody', () => {
    const groups = [hold(M1, 1000), release(M1, 600)];
    const settled = new Set([M1]);
    const buyer = computeWallet(BUYER, { groups, settledRefs: settled, payoutsPending: 0 });
    assert.equal(buyer.buyer.refundDue, 400);
    assert.equal(buyer.buyer.inEscrow, 0);
    assert.equal(buyer.buyer.released, 600);
    assert.equal(computeWallet(EXPERT, { groups, settledRefs: settled, payoutsPending: 0 }).expert.inEscrow, 0);
    const refunded = computeWallet(BUYER, { groups: [...groups, refund('CT-1/refund/r1', 400)], settledRefs: settled, payoutsPending: 0 });
    assert.equal(refunded.buyer.refundDue, 0);
  });

  it('a fully released milestone is unchanged: nothing due, nothing in escrow', () => {
    const groups = [hold(M1, 1000), release(M1, 1000)];
    const w = computeWallet(BUYER, { groups, settledRefs: new Set([M1]), payoutsPending: 0 });
    assert.deepEqual(w.buyer, { funded: 1000, released: 1000, refunded: 0, inEscrow: 0, refundDue: 0 });
  });

  it('sums in paise, so decimals add up exactly', () => {
    const groups = [hold(M1, 0.1), hold(M2, 0.2)];
    assert.equal(computeWallet(BUYER, { groups, settledRefs: none, payoutsPending: 0 }).buyer.funded, 0.3);
  });
});

describe('contractIdsOfRefs', () => {
  it('takes the contract id of milestone refs and skips anything else', () => {
    assert.deepEqual(contractIdsOfRefs([M1, M2, M3, null, 'TX-legacy']), ['CT-1', 'CT-2']);
  });
});

describe('LedgerService.getWallet', () => {
  it('feeds the grouped ledger rows, cancelled milestones and open payouts into the arithmetic', async () => {
    const sql: string[] = [];
    const params: unknown[][] = [];
    const replies = [
      {
        rows: [
          { type: 'Escrow hold', ref: M1, user_id: BUYER, payee_id: EXPERT, total: '-400.00' },
          { type: 'Escrow hold', ref: M2, user_id: BUYER, payee_id: EXPERT, total: '-600.00' },
          { type: 'Escrow release', ref: M1, user_id: EXPERT, payee_id: EXPERT, total: '400.00' },
        ],
      },
      { rows: [{ ref: M2 }] },
      { rows: [{ pending: '150.00' }] },
    ];
    const pool = {
      query: async (text: string, values: unknown[]) => { sql.push(text); params.push(values); return replies.shift(); },
    } as unknown as Pool;
    const w = await new LedgerService(pool).getWallet(EXPERT);
    assert.equal(w.expert.inEscrow, 0); // M2 is cancelled
    assert.equal(w.expert.available, 250);
    assert.deepEqual(params[1], [['CT-1']]);
    assert.match(sql[1], /status IN \('cancelled', 'released'\)/);
    assert.match(sql[2], /status IN \('requested', 'approved'\)/);
  });
});
