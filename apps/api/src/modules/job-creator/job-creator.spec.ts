import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { fakeDb } from '../../test-support/fakes';
import { CreditsService } from '../credits/credits.service';
import type { JobModel } from './job-model';
import { GenerateJobDto, JOB_CREATOR_FEATURE, JobCreatorService } from './job-creator.module';
import { apportion, normalizeGeneratedJob } from './normalize';

const DTO: GenerateJobDto = { rolePrompt: 'Backend engineer for our payments ledger', stack: ['Node.js', 'PostgreSQL'], band: 'senior' };

const MODEL_OUTPUT = {
  title: 'Senior Backend Engineer, Payments',
  summary: 'Own the ledger.',
  band: { label: 'Senior', yearsMin: 5, yearsMax: 9 },
  responsibilities: ['Design the ledger', 'Run Razorpay integration'],
  requirements: { mustHave: ['Node.js', 'SQL'], niceToHave: ['Payments'] },
  stack: ['TypeScript', 'Node.js'],
  screeningQuestions: [
    { question: 'Are you authorised to work in India?', type: 'yes_no', options: [], knockout: true, idealAnswer: 'Yes' },
    { question: 'Which databases have you run in production?', type: 'multiple_choice', options: ['Postgres'], knockout: false, idealAnswer: '' },
  ],
  evaluationRubric: [
    { criterion: 'System design', weight: 40, strongSignals: ['idempotency'], weakSignals: [] },
    { criterion: 'Code quality', weight: 30, strongSignals: [], weakSignals: [] },
    { criterion: 'Communication', weight: 20, strongSignals: [], weakSignals: [] },
  ],
  suggestedWeights: { iq: 50, eq: 25, grit: 25 },
};

/** A CreditsService whose wallet is the fake DB below: runMetered/consumeCredits run for real. */
function walletDb(balance: number) {
  return fakeDb([
    [/SELECT cost FROM credit_costs WHERE feature = \$1/, (p) => (p[0] === JOB_CREATOR_FEATURE ? [{ cost: 15 }] : [])],
    [/^INSERT INTO wallets/, []],
    [/^SELECT 1 FROM wallets/, [{}]],
    [/^WITH stale AS/, [{ balance, subscription_tier: 'free', subscription_status: null, current_period_end: null }]],
    [/FROM credit_transactions\s+WHERE user_id = \$1 AND type IN/, balance
      ? [{ id: 'lot-1', remaining_amount: balance, expires_at: null, created_at: new Date('2026-01-01'), db_now: new Date() }]
      : []],
    [/^UPDATE credit_transactions t SET remaining_amount = t.remaining_amount - v.amt/, []],
    [/^INSERT INTO credit_transactions \(user_id, type, amount, feature_key/, [{ id: 'spend-1' }]],
    [/^UPDATE credit_transactions\s+SET status = 'refunded'/, [{ user_id: 'emp-1', amount: -15, feature_key: JOB_CREATOR_FEATURE, metadata: { allocations: [{ lotId: 'lot-1', amount: 15 }] } }]],
    [/^SELECT id, expires_at, NOW\(\) AS db_now FROM credit_transactions/, [{ id: 'lot-1', expires_at: null, db_now: new Date() }]],
    [/^INSERT INTO credit_transactions\s+\(user_id, type, amount, remaining_amount, expires_at/, [{ id: 'refund-1' }]],
    [/^UPDATE wallets SET balance = balance \+ \$2/, (p) => [{ balance: balance + Number(p[1]) }]],
  ]);
}

function setup(balance: number, model: JobModel | null) {
  const db = walletDb(balance);
  return { db, svc: new JobCreatorService(new CreditsService(db.pool), model) };
}

const modelReturning = (out: unknown) => {
  let calls = 0;
  return { model: { generate: async () => { calls++; return out; } } as JobModel, calls: () => calls };
};

describe('POST /ai/jobs/generate (credit deduction)', () => {
  it('deducts the ai_job_creator price with consumeCredits, FIFO, before generating; returns the new balance', async () => {
    const { db, svc } = setup(40, modelReturning(MODEL_OUTPUT).model);
    const out = await svc.generate({ id: 'emp-1' }, DTO);
    assert.deepEqual(out.credits, { charged: 15, balance: 25 });
    const [spend] = db.all(/^INSERT INTO credit_transactions \(user_id, type, amount, feature_key/);
    assert.deepEqual(spend.params.slice(0, 3), ['emp-1', -15, JOB_CREATOR_FEATURE]);
    assert.deepEqual(db.all(/remaining_amount - v.amt/)[0].params, [['lot-1'], [15]]);
    assert.equal(db.all(/SET status = 'refunded'/).length, 0, 'no refund on success');
    assert.equal(out.job.title, 'Senior Backend Engineer, Payments');
  });

  it('402 INSUFFICIENT_CREDITS and the model is never called when the wallet is short', async () => {
    const m = modelReturning(MODEL_OUTPUT);
    const { svc } = setup(10, m.model);
    await assert.rejects(svc.generate({ id: 'emp-1' }, DTO), (err: unknown) =>
      err instanceof HttpException && err.getStatus() === 402
      && (err.getResponse() as { errors: { code: string } }).errors.code === 'INSUFFICIENT_CREDITS');
    assert.equal(m.calls(), 0);
  });

  it('refunds the charge when the model fails', async () => {
    const { db, svc } = setup(40, { generate: async () => { throw new Error('upstream 500'); } });
    await assert.rejects(svc.generate({ id: 'emp-1' }, DTO), /upstream 500/);
    assert.equal(db.all(/SET status = 'refunded'/).length, 1);
    assert.deepEqual(db.all(/^UPDATE wallets SET balance = balance \+ \$2/).map((q) => q.params[1]), [-15, 15]);
  });

  it('refunds when the model returns an unusable (empty) job', async () => {
    const { db, svc } = setup(40, modelReturning({ title: 'x' }).model);
    await assert.rejects(svc.generate({ id: 'emp-1' }, DTO), ServiceUnavailableException);
    assert.equal(db.all(/SET status = 'refunded'/).length, 1);
  });

  it('503 without a model, and charges nothing', async () => {
    const { db, svc } = setup(40, null);
    await assert.rejects(svc.generate({ id: 'emp-1' }, DTO), ServiceUnavailableException);
    assert.equal(db.log.length, 0);
  });
});

describe('normalizeGeneratedJob', () => {
  const input = { rolePrompt: DTO.rolePrompt, stack: DTO.stack, band: DTO.band, questionCount: 6 };

  it('rubric and suggested weights always sum to exactly 100 in whole numbers', () => {
    const job = normalizeGeneratedJob(MODEL_OUTPUT, input);
    assert.deepEqual(job.evaluationRubric.map((c) => c.weight), [45, 33, 22]); // 40/30/20 → 44.4/33.3/22.2, largest remainder
    assert.equal(job.evaluationRubric.reduce((s, c) => s + c.weight, 0), 100);
    const sw = job.suggestedWeights;
    assert.equal(sw.iq + sw.eq + sw.grit, 100);
  });

  it('keeps the caller’s band and stack, and repairs bad questions', () => {
    const job = normalizeGeneratedJob({ ...MODEL_OUTPUT, band: { label: 'Staff', yearsMin: 12, yearsMax: 3 } }, input);
    assert.equal(job.band.level, 'senior');
    assert.equal(job.band.yearsMax, 12, 'max never below min');
    assert.deepEqual(job.stack, ['Node.js', 'PostgreSQL', 'TypeScript']);
    assert.equal(job.screeningQuestions[1].type, 'short_text', 'one-option multiple choice becomes free text');
    assert.equal(job.screeningQuestions[0].knockout, true);
  });

  it('apportion: proportional, whole, sums to the total, nobody at zero', () => {
    for (const raw of [[1, 1, 1], [70, 20, 5, 5], [0, 0], [NaN, 50], [1000, 1, 1, 1]]) {
      const w = apportion(raw);
      assert.equal(w.reduce((a, b) => a + b, 0), 100, String(raw));
      assert.ok(w.every((x) => Number.isInteger(x) && x >= 1), String(w));
    }
    assert.deepEqual(apportion([1, 1, 1]), [34, 33, 33]);
  });
});
