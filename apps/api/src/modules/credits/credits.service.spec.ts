import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { CallHandler, ExecutionContext } from '@nestjs/common';
import type { Reflector } from '@nestjs/core';
import { lastValueFrom, throwError, of } from 'rxjs';
import { fakeDb, type Route } from '../../test-support/fakes';
import { CreditChargeInterceptor } from './charge-credits';
import { CreditsService } from './credits.service';

const USER = 'user-1';
const t = (iso: string) => new Date(iso);
const DB_NOW = t('2026-11-13T12:00:00Z');

/** Wallet plumbing every ledger transaction goes through (create, lock, expire). */
function walletRoutes(balance: number): Route[] {
  return [
    [/^INSERT INTO wallets/, []],
    [/^SELECT 1 FROM wallets/, [{}]],
    [/^WITH stale AS/, [{ balance, subscription_tier: 'free', subscription_status: null, current_period_end: null }]],
  ];
}

/** Lots as the FIFO query returns them (already ordered oldest first by SQL). */
const lots = [
  { id: 'lot-old', remaining_amount: 4, expires_at: null, created_at: t('2026-10-01T00:00:00Z'), db_now: DB_NOW },
  { id: 'lot-mid', remaining_amount: 10, expires_at: t('2026-12-01T00:00:00Z'), created_at: t('2026-11-01T00:00:00Z'), db_now: DB_NOW },
  { id: 'lot-new', remaining_amount: 50, expires_at: null, created_at: t('2026-11-10T00:00:00Z'), db_now: DB_NOW },
];

function consumeDb(balance = 64) {
  return fakeDb([
    ...walletRoutes(balance),
    [/FROM credit_transactions\s+WHERE user_id = \$1 AND type IN/, lots],
    [/^UPDATE credit_transactions t SET remaining_amount = t.remaining_amount - v.amt/, []],
    [/^INSERT INTO credit_transactions \(user_id, type, amount, feature_key/, [{ id: 'spend-1' }]],
    [/^UPDATE wallets SET balance = balance \+ \$2/, (p) => [{ balance: balance + Number(p[1]) }]],
  ]);
}

describe('CreditsService.consumeCredits (FIFO deduction)', () => {
  it('draws the oldest lots first, records the spend and lowers the balance in one transaction', async () => {
    const db = consumeDb();
    const charge = await new CreditsService(db.pool).consumeCredits(USER, 15, 'ai_search');

    assert.deepEqual(charge, { transactionId: 'spend-1', cost: 15, featureKey: 'ai_search', balance: 49 });
    const [draw] = db.all(/remaining_amount - v.amt/);
    assert.deepEqual(draw.params, [['lot-old', 'lot-mid', 'lot-new'], [4, 10, 1]]);

    const [spend] = db.all(/^INSERT INTO credit_transactions \(user_id, type, amount, feature_key/);
    assert.deepEqual(spend.params.slice(0, 3), [USER, -15, 'ai_search']);
    assert.deepEqual(JSON.parse(String(spend.params[3])).allocations, [
      { lotId: 'lot-old', amount: 4 }, { lotId: 'lot-mid', amount: 10 }, { lotId: 'lot-new', amount: 1 },
    ]);
    assert.deepEqual(db.all(/^UPDATE wallets SET balance/)[0].params, [USER, -15]);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('locks the wallet (and expires stale lots) before reading lots', async () => {
    const db = consumeDb();
    await new CreditsService(db.pool).consumeCredits(USER, 1, 'quick_connect');
    const order = db.log.map((q) => q.sql).filter((s) => !/^(BEGIN|COMMIT)$/.test(s));
    assert.match(order[0], /^INSERT INTO wallets/);
    assert.match(order[1], /FOR UPDATE/);
    assert.match(order[2], /^WITH stale AS/);
    assert.match(order[3], /ORDER BY created_at, id\s+FOR UPDATE/);
  });

  it('answers 402 INSUFFICIENT_CREDITS and changes nothing when the lots cannot cover the cost', async () => {
    const db = consumeDb();
    await assert.rejects(new CreditsService(db.pool).consumeCredits(USER, 65, 'ai_search'), (err: unknown) => {
      assert.ok(err instanceof HttpException);
      assert.equal(err.getStatus(), 402);
      assert.deepEqual((err.getResponse() as { errors: unknown }).errors, { code: 'INSUFFICIENT_CREDITS', required: 65, balance: 64 });
      return true;
    });
    assert.equal(db.all(/remaining_amount - v.amt|INSERT INTO credit_transactions|UPDATE wallets SET balance/).length, 0);
    assert.deepEqual(db.tx(), ['BEGIN', 'ROLLBACK']);
  });

  it('rejects a non-positive or fractional cost before touching the database', async () => {
    const db = consumeDb();
    for (const cost of [0, -1, 2.5]) {
      await assert.rejects(new CreditsService(db.pool).consumeCredits(USER, cost, 'x'), HttpException);
    }
    assert.equal(db.log.length, 0);
  });
});

function refundDb(opts: { alreadyRefunded?: boolean; liveLots?: { id: string; expires_at: Date | null }[] } = {}) {
  const live = opts.liveLots ?? [{ id: 'lot-old', expires_at: null }, { id: 'lot-mid', expires_at: t('2026-12-01T00:00:00Z') }];
  return fakeDb([
    [/^UPDATE credit_transactions\s+SET status = 'refunded'/, opts.alreadyRefunded ? [] : [{
      user_id: USER, amount: -15, feature_key: 'ai_search',
      metadata: { allocations: [{ lotId: 'lot-old', amount: 4 }, { lotId: 'lot-mid', amount: 10 }, { lotId: 'lot-new', amount: 1 }] },
    }]],
    ...walletRoutes(49),
    [/^SELECT id, expires_at, NOW\(\) AS db_now FROM credit_transactions/, live.map((l) => ({ ...l, db_now: DB_NOW }))],
    [/remaining_amount \+ v.amt/, []],
    [/^INSERT INTO credit_transactions\s+\(user_id, type, amount, remaining_amount, expires_at/, [{ id: 'refund-1' }]],
    [/^UPDATE wallets SET balance = balance \+ \$2/, (p) => [{ balance: 49 + Number(p[1]) }]],
  ]);
}

describe('CreditsService.refundSpend', () => {
  it('returns credits to their original lots and reissues the part whose lot is gone', async () => {
    // lot-new (1 credit) is missing from the live lots: it expired since the spend.
    const db = refundDb();
    const out = await new CreditsService(db.pool).refundSpend('spend-1', 'task_failed');
    assert.deepEqual(out, { refundId: 'refund-1', balance: 64 });

    assert.deepEqual(db.all(/remaining_amount \+ v.amt/)[0].params, [['lot-old', 'lot-mid'], [4, 10]]);
    const [refund] = db.all(/^INSERT INTO credit_transactions\s+\(user_id, type, amount, remaining_amount/);
    // amount 15 back in the ledger; 1 of it spendable as a new lot (with an expiry), reference = the spend.
    assert.deepEqual(refund.params.slice(0, 6), [USER, 15, 1, 30, 'ai_search', 'spend-1']);
    assert.deepEqual(db.all(/^UPDATE wallets SET balance/)[0].params, [USER, 15]);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('refunds at most once: a second call finds the spend already refunded and changes nothing', async () => {
    const db = refundDb({ alreadyRefunded: true });
    assert.equal(await new CreditsService(db.pool).refundSpend('spend-1'), null);
    assert.equal(db.all(/UPDATE wallets|INSERT INTO credit_transactions|remaining_amount \+/).length, 0);
  });

  it('flips the spend to refunded only while it is still completed (the atomic guard)', async () => {
    const db = refundDb();
    await new CreditsService(db.pool).refundSpend('spend-1');
    assert.match(db.log[1].sql, /WHERE id = \$1 AND type = 'spend' AND status = 'completed'/);
  });
});

/** A CreditsService whose ledger calls are recorded instead of hitting a database. */
function recordingCredits(opts: { refundFails?: boolean } = {}) {
  const calls: string[] = [];
  const svc = new CreditsService(fakeDb([]).pool);
  svc.costOf = async () => 15;
  svc.consumeCredits = async (_u, cost, featureKey) => {
    calls.push(`consume:${cost}`);
    return { transactionId: 'spend-1', cost, featureKey, balance: 49 };
  };
  svc.refundSpend = async (id, reason) => {
    calls.push(`refund:${id}:${reason?.split(':')[0]}`);
    if (opts.refundFails) throw new Error('db down');
    return { refundId: 'refund-1', balance: 64 };
  };
  return { svc, calls };
}

describe('CreditsService.runMetered (auto-refund hook)', () => {
  it('refunds the charge when the AI task fails, and rethrows the task error unchanged', async () => {
    const { svc, calls } = recordingCredits();
    const boom = new Error('model timeout');
    await assert.rejects(svc.runMetered(USER, 'ai_search', async () => { throw boom; }), (err) => err === boom);
    assert.deepEqual(calls, ['consume:15', 'refund:spend-1:task_failed']);
  });

  it('keeps the charge when the task succeeds', async () => {
    const { svc, calls } = recordingCredits();
    const out = await svc.runMetered(USER, 'ai_search', async (charge) => `ok:${charge.transactionId}`);
    assert.equal(out, 'ok:spend-1');
    assert.deepEqual(calls, ['consume:15']);
  });

  it('never runs the task when the charge is refused', async () => {
    const { svc } = recordingCredits();
    svc.consumeCredits = async () => { throw new HttpException('no credits', 402); };
    let ran = false;
    await assert.rejects(svc.runMetered(USER, 'ai_search', async () => { ran = true; }), HttpException);
    assert.equal(ran, false);
  });

  it('still surfaces the task error when the refund itself fails', async () => {
    const { svc, calls } = recordingCredits({ refundFails: true });
    const boom = new Error('model timeout');
    await assert.rejects(svc.runMetered(USER, 'ai_search', async () => { throw boom; }, 5), (err) => err === boom);
    assert.deepEqual(calls, ['consume:5', 'refund:spend-1:task_failed']);
  });
});

describe('CreditChargeInterceptor', () => {
  const ctxFor = (headers: Record<string, string>) => ({
    getHandler: () => () => undefined,
    switchToHttp: () => ({
      getRequest: () => ({ user: { id: USER } }),
      getResponse: () => ({ setHeader: (k: string, v: string) => { headers[k] = v; } }),
    }),
  }) as unknown as ExecutionContext;
  const reflector = (meta: unknown) => ({ get: () => meta }) as unknown as Reflector;

  it('charges before the handler and refunds when the handler errors', async () => {
    const { svc, calls } = recordingCredits();
    const headers: Record<string, string> = {};
    const icpt = new CreditChargeInterceptor(reflector({ featureKey: 'ai_search' }), svc);
    const boom = new Error('upstream 500');
    const obs = await icpt.intercept(ctxFor(headers), { handle: () => throwError(() => boom) } as CallHandler);
    await assert.rejects(lastValueFrom(obs), (err) => err === boom);
    assert.deepEqual(calls, ['consume:15', 'refund:spend-1:task_failed']);
    assert.equal(headers['X-Credits-Balance'], '49');
  });

  it('does not refund a successful handler, and leaves unmetered handlers alone', async () => {
    const { svc, calls } = recordingCredits();
    const metered = new CreditChargeInterceptor(reflector({ featureKey: 'ai_search', cost: 3 }), svc);
    assert.equal(await lastValueFrom(await metered.intercept(ctxFor({}), { handle: () => of('done') } as CallHandler)), 'done');
    const free = new CreditChargeInterceptor(reflector(undefined), svc);
    assert.equal(await lastValueFrom(await free.intercept(ctxFor({}), { handle: () => of('free') } as CallHandler)), 'free');
    assert.deepEqual(calls, ['consume:3']);
  });
});
