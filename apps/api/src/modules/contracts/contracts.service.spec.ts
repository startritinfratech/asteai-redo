import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import type { NotificationsService } from '../notifications/notifications.service';
import { ContractsService } from './contracts.service';
import { CONTRACT_MILESTONE_STATUSES, paymentTermsError, paymentTermsTotal } from './contract.types';
import { MILESTONE_ACTIONS, type MilestoneAction } from './contract-rules';
import type { CreateContractDto } from './dto/contract.dto';

type Reply = { rows: unknown[] } | { error: unknown };

/** A pool that answers queries in order from `replies` and records the SQL and params it saw. */
function fakePool(replies: Reply[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    const next = replies.shift() ?? { rows: [] };
    if ('error' in next) throw next.error;
    return { rowCount: next.rows.length, ...next };
  };
  // withTransaction() takes a client from the pool; the fake hands back itself.
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

function fakeNotifications() {
  const sent: { userId: string; text: string; link: string }[] = [];
  const svc = {
    send: async (userId: string, text: string, link: string) => { sent.push({ userId, text, link }); return {}; },
  } as unknown as NotificationsService;
  return { svc, sent };
}

function setup(replies: Reply[]) {
  const db = fakePool(replies);
  const n = fakeNotifications();
  return { ...db, sent: n.sent, svc: new ContractsService(db.pool, n.svc) };
}

const status = (code: number) => (e: HttpException) => e.getStatus() === code;
const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });

const buyer = { id: 'buyer-1', role: 'Buyer', firstName: 'Bina' } as User;
const expert = { id: 'exp-1', role: 'Freelancer', firstName: 'Eshan' } as User;
const admin = { id: 'adm-1', role: 'Admin' } as User;
const outsider = { id: 'other-1', role: 'Buyer' } as User;

const contractRow = (over: Record<string, unknown> = {}) => ({
  id: 'CT-1', project_id: 'PRJ-1', proposal_id: 'P-1', tenant_id: 'T-1', buyer_id: 'buyer-1', expert_id: 'exp-1',
  engagement_model: 'fixed', payment_terms: { totalAmount: 1000 }, currency: 'INR', total_amount: '1000.00',
  escrow_funded: '0.00', released: '0.00', status: 'active', nda_required: false, nda_text: null,
  buyer_signed_at: null, expert_signed_at: null, buyer_signature: null, expert_signature: null,
  cancelled_by: null, cancel_reason: null, source: 'app', created_at: new Date(), updated_at: new Date(),
  project_title: 'Proj', buyer_name: 'Bina Buyer', expert_name: 'Eshan Expert',
  ...over,
});
const MID = '11111111-1111-4111-8111-111111111111';
const milestoneRow = (over: Record<string, unknown> = {}) => ({
  id: MID, contract_id: 'CT-1', seq: 1, title: 'Design', amount: '400.00', due_date: null, status: 'pending',
  funded_at: null, submitted_at: null, accepted_at: null, released_at: null, revision_count: 0,
  submission_note: null, revision_note: null, ...over,
});
/** Replies for the findOne() that follows most successful writes. */
const reload = (over: Record<string, unknown> = {}): Reply[] => [{ rows: [contractRow(over)] }, { rows: [milestoneRow()] }];

const createDto = (over: Partial<CreateContractDto> = {}): CreateContractDto => ({
  proposalId: 'P-1',
  engagementModel: 'fixed',
  paymentTerms: { totalAmount: 1000 },
  milestones: [{ title: 'Design', amount: 400 }, { title: 'Build', amount: 600, dueDate: '2026-12-31' }],
  ndaRequired: false,
  ...over,
});
const proposalRow = (over: Record<string, unknown> = {}) => ({
  id: 'P-1', expert_id: 'exp-1', status: 'Awarded', project_id: 'PRJ-1', buyer_id: 'buyer-1', awarded_to: 'exp-1',
  tenant_id: 'T-1', ...over,
});

// ─── Payment terms ──────────────────────────────────────────────────────────

describe('payment terms', () => {
  it('computes the contract value per engagement model', () => {
    assert.equal(paymentTermsTotal('fixed', { totalAmount: 1234.5 }), 1234.5);
    assert.equal(paymentTermsTotal('hourly', { hourlyRate: 1500, estimatedHours: 40 }), 60000);
    assert.equal(paymentTermsTotal('daily', { dailyRate: 8000, totalDays: 5 }), 40000);
    assert.equal(paymentTermsTotal('sprint', { sprintRate: 50000, sprintDurationDays: 14, totalSprints: 3 }), 150000);
    assert.equal(paymentTermsTotal('hourly', { hourlyRate: 0.1, estimatedHours: 3 }), 0.3);
  });

  it('rejects missing, non-positive, fractional-count and unknown fields', () => {
    assert.equal(paymentTermsError('fixed', { totalAmount: 10 }), null);
    assert.match(paymentTermsError('hourly', { hourlyRate: 10 }) ?? '', /estimatedHours/);
    assert.match(paymentTermsError('daily', { dailyRate: 10, totalDays: 2.5 }) ?? '', /whole number/);
    assert.match(paymentTermsError('sprint', { sprintRate: -1, sprintDurationDays: 7, totalSprints: 2 }) ?? '', /sprintRate/);
    assert.match(paymentTermsError('fixed', { totalAmount: 10, hourlyRate: 5 }) ?? '', /Unexpected/);
    assert.match(paymentTermsError('fixed', null) ?? '', /object/);
    assert.match(paymentTermsError('fixed', { totalAmount: '10' }) ?? '', /positive/);
  });
});

// ─── Create ─────────────────────────────────────────────────────────────────

describe('ContractsService.create', () => {
  it('creates a pending_signature contract and notifies the expert', async () => {
    const { svc, sql, params, sent } = setup([
      { rows: [proposalRow()] }, { rows: [] }, { rows: [] }, { rows: [] }, ...reload({ status: 'pending_signature' }),
    ]);
    const out = await svc.create(createDto(), buyer);
    assert.equal(out.status, 'pending_signature');
    const insert = sql.findIndex((q) => /INSERT INTO contracts/.test(q));
    assert.match(sql[insert], /'pending_signature'/);
    assert.equal(params[insert][9], 1000); // total_amount from the payment terms
    const ms = sql.findIndex((q) => /INSERT INTO contract_milestones/.test(q));
    assert.deepEqual(params[ms][2], ['Design', 'Build']);
    assert.deepEqual(params[ms][4], [null, '2026-12-31']);
    assert.ok(sql.indexOf('COMMIT') > ms);
    assert.deepEqual(sent.map((s) => s.userId), ['exp-1']);
  });

  it('refuses when the milestones do not add up to the terms total', async () => {
    const { svc, sql } = setup([]);
    await assert.rejects(
      svc.create(createDto({ milestones: [{ title: 'All', amount: 999.99 }] }), buyer), status(400));
    assert.equal(sql.length, 0);
  });

  it('accepts sums that only match after rounding to paise', async () => {
    const { svc } = setup([{ rows: [proposalRow()] }, { rows: [] }, { rows: [] }, { rows: [] }, ...reload()]);
    await svc.create(createDto({
      paymentTerms: { totalAmount: 0.3 },
      milestones: [{ title: 'a', amount: 0.1 }, { title: 'b', amount: 0.2 }],
    }), buyer);
  });

  it('refuses payment terms that do not fit the engagement model', async () => {
    const { svc } = setup([]);
    await assert.rejects(svc.create(createDto({ engagementModel: 'hourly' }), buyer), status(400));
  });

  it('requires NDA text when an NDA is required', async () => {
    const { svc } = setup([]);
    await assert.rejects(svc.create(createDto({ ndaRequired: true, ndaText: '  ' }), buyer), status(400));
  });

  it("refuses anyone but the project's buyer", async () => {
    const { svc, sql } = setup([{ rows: [proposalRow({ buyer_id: 'someone-else' })] }]);
    await assert.rejects(svc.create(createDto(), buyer), status(403));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  for (const over of [{ status: 'Pending' }, { status: 'Rejected' }, { awarded_to: 'exp-2' }, { awarded_to: null }]) {
    it(`refuses a proposal that is not the awarded one (${JSON.stringify(over)})`, async () => {
      const { svc, sql } = setup([{ rows: [proposalRow(over)] }]);
      await assert.rejects(svc.create(createDto(), buyer), status(409));
      assert.ok(!sql.some((q) => /^\s*INSERT/.test(q)));
    });
  }

  it('refuses a second contract for the same proposal', async () => {
    const { svc } = setup([{ rows: [proposalRow()] }, { rows: [{ id: 'CT-OLD' }] }]);
    await assert.rejects(svc.create(createDto(), buyer), status(409));
  });

  it('maps a concurrent duplicate insert to 409', async () => {
    const { svc, sql } = setup([{ rows: [proposalRow()] }, { rows: [] }, { error: uniqueViolation }]);
    await assert.rejects(svc.create(createDto(), buyer), status(409));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  it('404s an unknown proposal', async () => {
    const { svc } = setup([{ rows: [] }]);
    await assert.rejects(svc.create(createDto(), buyer), status(404));
  });
});

// ─── Read access ────────────────────────────────────────────────────────────

describe('ContractsService.findOne / findAll', () => {
  it('shows a contract to its parties and admins only', async () => {
    for (const user of [buyer, expert, admin]) {
      const { svc } = setup(reload());
      const out = await svc.findOne('CT-1', user);
      assert.equal(out.milestones[0].amount, 400);
    }
    const { svc } = setup(reload());
    await assert.rejects(svc.findOne('CT-1', outsider), status(403));
  });

  it("lists only the caller's contracts, admins all", async () => {
    const mine = setup([{ rows: [] }]);
    await mine.svc.findAll(buyer, 'active', { page: 1, pageSize: 20, offset: 0 });
    assert.match(mine.sql[0], /buyer_id = \$1 OR c.expert_id = \$1/);
    assert.deepEqual(mine.params[0], ['buyer-1', 'active', 20, 0]);
    const all = setup([{ rows: [] }]);
    await all.svc.findAll(admin, undefined, { page: 1, pageSize: 20, offset: 0 });
    assert.ok(!/WHERE/.test(all.sql[0].split('JOIN user_accounts e')[1]));
  });
});

// ─── Signing ────────────────────────────────────────────────────────────────

describe('ContractsService.sign', () => {
  const pending = contractRow({ status: 'pending_signature' });
  const name = { rows: [{ first_name: 'Bina', last_name: 'Buyer' }] };

  it('records the typed name and IP (case-insensitive match) and waits for the other side', async () => {
    const { svc, sql, params, sent } = setup([
      { rows: [pending] }, name, { rows: [contractRow({ status: 'pending_signature', buyer_signed_at: new Date() })] },
      ...reload(),
    ]);
    await svc.sign('CT-1', '  bina   BUYER ', '10.0.0.1', buyer);
    const update = sql.findIndex((q) => /UPDATE contracts/.test(q));
    assert.match(sql[update], /buyer_signed_at = NOW\(\)/);
    assert.match(sql[update], /buyer_signed_at IS NULL/);
    assert.deepEqual(params[update], ['CT-1', 'bina   BUYER', '10.0.0.1']);
    assert.deepEqual(sent.map((s) => s.userId), ['exp-1']);
  });

  it('activates the contract on the second signature and notifies both', async () => {
    const { svc, sent } = setup([
      { rows: [contractRow({ status: 'pending_signature', buyer_signed_at: new Date() })] },
      { rows: [{ first_name: 'Eshan', last_name: 'Expert' }] },
      { rows: [contractRow({ status: 'active' })] },
      ...reload(),
    ]);
    await svc.sign('CT-1', 'Eshan Expert', '10.0.0.2', expert);
    assert.deepEqual(sent.map((s) => s.userId).sort(), ['buyer-1', 'exp-1']);
  });

  it('refuses a name that does not match the account', async () => {
    const { svc, sql } = setup([{ rows: [pending] }, name]);
    await assert.rejects(svc.sign('CT-1', 'Someone Else', undefined, buyer), status(400));
    assert.ok(!sql.some((q) => /^\s*UPDATE/.test(q)));
  });

  it('refuses signing twice', async () => {
    const { svc } = setup([{ rows: [contractRow({ status: 'pending_signature', buyer_signed_at: new Date() })] }]);
    await assert.rejects(svc.sign('CT-1', 'Bina Buyer', undefined, buyer), status(409));
  });

  for (const s of ['active', 'cancelled', 'completed']) {
    it(`refuses signing a '${s}' contract`, async () => {
      const { svc } = setup([{ rows: [contractRow({ status: s })] }]);
      await assert.rejects(svc.sign('CT-1', 'Bina Buyer', undefined, buyer), status(409));
    });
  }

  it('refuses non-parties, admins included', async () => {
    for (const user of [admin, outsider]) {
      const { svc } = setup([{ rows: [pending] }]);
      await assert.rejects(svc.sign('CT-1', 'X Y', undefined, user), status(403));
    }
  });

  it('refuses when the conditional update loses a race', async () => {
    const { svc, sql } = setup([{ rows: [pending] }, name, { rows: [] }]);
    await assert.rejects(svc.sign('CT-1', 'Bina Buyer', undefined, buyer), status(409));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });
});

describe('ContractsService.decline', () => {
  it('lets the expert decline before signing', async () => {
    const { svc, sql, sent } = setup([
      { rows: [contractRow({ status: 'pending_signature' })] }, { rows: [contractRow({ status: 'cancelled' })] }, { rows: [] },
      ...reload({ status: 'cancelled' }),
    ]);
    await svc.decline('CT-1', 'Busy', expert);
    assert.ok(sql.some((q) => /SET status = 'cancelled'/.test(q)));
    assert.deepEqual(sent.map((s) => s.userId), ['buyer-1']);
  });

  it('refuses the buyer, and an expert who already signed', async () => {
    const a = setup([{ rows: [contractRow({ status: 'pending_signature' })] }]);
    await assert.rejects(a.svc.decline('CT-1', undefined, buyer), status(403));
    const b = setup([{ rows: [contractRow({ status: 'pending_signature', expert_signed_at: new Date() })] }]);
    await assert.rejects(b.svc.decline('CT-1', undefined, expert), status(409));
  });
});

// ─── Milestone transitions: every action × status × role ────────────────────

describe('milestone transitions', () => {
  const run: Record<MilestoneAction, (svc: ContractsService, user: User) => Promise<unknown>> = {
    submit: (svc, u) => svc.submitMilestone('CT-1', MID, 'done', u),
    request_revision: (svc, u) => svc.requestRevision('CT-1', MID, 'fix it', u),
    accept: (svc, u) => svc.acceptMilestone('CT-1', MID, u),
    release: (svc, u) => svc.releaseMilestone('CT-1', MID, u),
  };
  const roles = { buyer, expert, admin, outsider } as const;

  for (const action of Object.keys(MILESTONE_ACTIONS) as MilestoneAction[]) {
    const rule = MILESTONE_ACTIONS[action];
    for (const [roleName, user] of Object.entries(roles)) {
      for (const from of CONTRACT_MILESTONE_STATUSES) {
        const roleOk = roleName === rule.by;
        const statusOk = (rule.from as readonly string[]).includes(from);
        const expected = !roleOk ? 403 : !statusOk ? 409 : 200;
        it(`${action} by ${roleName} from '${from}' → ${expected}`, async () => {
          const funded = { escrow_funded: '400.00' };
          const replies: Reply[] = [{ rows: [contractRow(funded)] }, { rows: [milestoneRow({ status: from })] }];
          if (expected === 200) {
            replies.push({ rows: [{ id: MID }] });
            if (action === 'release') replies.push({ rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ open: '1' }] });
            replies.push(...reload());
          }
          const { svc, sql, params } = setup(replies);
          const call = run[action](svc, user);
          if (expected !== 200) {
            await assert.rejects(call, status(expected));
            assert.ok(!sql.some((q) => /^\s*(UPDATE|INSERT)/.test(q)));
            return;
          }
          await call;
          const i = sql.findIndex((q) => /UPDATE contract_milestones/.test(q));
          assert.match(sql[i], new RegExp(`SET status = '${rule.to}'`));
          assert.match(sql[i], /WHERE id = \$1 AND status = \$2/);
          assert.equal(params[i][1], from);
          if (action === 'request_revision') assert.match(sql[i], /revision_count = revision_count \+ 1/);
        });
      }
    }
  }

  it('refuses moves while the contract is not active', async () => {
    for (const s of ['pending_signature', 'cancelled', 'completed', 'disputed']) {
      const { svc } = setup([{ rows: [contractRow({ status: s })] }]);
      await assert.rejects(svc.acceptMilestone('CT-1', MID, buyer), status(409));
    }
  });

  it('404s a milestone of another contract', async () => {
    const { svc } = setup([{ rows: [contractRow()] }, { rows: [] }]);
    await assert.rejects(svc.acceptMilestone('CT-1', MID, buyer), status(404));
  });
});

// ─── Release ────────────────────────────────────────────────────────────────

describe('ContractsService.releaseMilestone', () => {
  it('releases, credits the expert in the ledger and completes the contract, in one transaction', async () => {
    const { svc, sql, params, sent } = setup([
      { rows: [contractRow({ escrow_funded: '1000.00', released: '600.00' })] },
      { rows: [milestoneRow({ status: 'accepted' })] },
      { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ open: '0' }] }, { rows: [] },
      ...reload({ status: 'completed' }),
    ]);
    await svc.releaseMilestone('CT-1', MID, buyer);
    const begin = sql.indexOf('BEGIN');
    const commit = sql.indexOf('COMMIT');
    const ms = sql.findIndex((q) => /UPDATE contract_milestones SET status = 'released'/.test(q));
    const total = sql.findIndex((q) => /SET released = released \+ \$2/.test(q));
    const ledger = sql.findIndex((q) => /INSERT INTO ledger_entries/.test(q));
    const done = sql.findIndex((q) => /SET status = 'completed'/.test(q));
    for (const i of [ms, total, ledger, done]) assert.ok(i > begin && i < commit, `statement ${i} inside the transaction`);
    assert.match(sql[total], /released \+ \$2 <= escrow_funded/);
    assert.match(sql[done], /UPDATE projects pj SET stage = 'Completed'/);
    assert.match(sql[done], /stage NOT IN \('Completed', 'Disputed'\)/);
    assert.equal(params[total][1], '400.00');
    const [, , userId, type, , amount, unit, payee, by] = params[ledger];
    assert.deepEqual([userId, type, amount, unit, payee, by], ['exp-1', 'Escrow release', 400, 'INR', 'exp-1', 'buyer-1']);
    assert.ok(sent.some((s) => s.userId === 'exp-1' && /released/.test(s.text)));
    assert.ok(sent.some((s) => /complete/.test(s.text)));
  });

  it('keeps the contract active while milestones remain', async () => {
    const { svc, sql } = setup([
      { rows: [contractRow({ escrow_funded: '400.00' })] }, { rows: [milestoneRow({ status: 'accepted' })] },
      { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ open: '2' }] }, ...reload(),
    ]);
    await svc.releaseMilestone('CT-1', MID, buyer);
    assert.ok(!sql.some((q) => /SET status = 'completed'/.test(q)));
  });

  it('rolls back without a ledger row when escrow cannot cover the release', async () => {
    const { svc, sql } = setup([
      { rows: [contractRow()] }, { rows: [milestoneRow({ status: 'accepted' })] }, { rows: [{ id: MID }] }, { rows: [] },
    ]);
    await assert.rejects(svc.releaseMilestone('CT-1', MID, buyer), status(409));
    assert.ok(!sql.some((q) => /ledger_entries/.test(q)));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });
});

// ─── Funding & capture ──────────────────────────────────────────────────────

describe('ContractsService.fundMilestone', () => {
  it('opens a pending payment and does not fund the milestone', async () => {
    const { svc, sql, params } = setup([
      { rows: [contractRow()] }, { rows: [milestoneRow()] }, { rows: [] },
      { rows: [{ id: 'pay-1', amount: '400.00', provider: 'pending', status: 'pending' }] },
    ]);
    const out = await svc.fundMilestone('CT-1', MID, buyer);
    assert.deepEqual(out, { paymentId: 'pay-1', amount: 400, provider: 'pending', status: 'pending' });
    const insert = sql.findIndex((q) => /INSERT INTO escrow_payments/.test(q));
    assert.equal(params[insert][2], '400.00'); // amount from the milestone, never from the browser
    assert.ok(!sql.some((q) => /^\s*UPDATE/.test(q)));
    assert.ok(!sql.some((q) => /ledger_entries/.test(q)));
  });

  it('returns the open payment instead of creating a second one', async () => {
    const { svc, sql } = setup([
      { rows: [contractRow()] }, { rows: [milestoneRow()] },
      { rows: [{ id: 'pay-1', amount: '400.00', provider: 'pending', status: 'pending' }] },
    ]);
    assert.equal((await svc.fundMilestone('CT-1', MID, buyer)).paymentId, 'pay-1');
    assert.ok(!sql.some((q) => /^\s*INSERT/.test(q)));
  });

  it('refuses the expert, an admin, inactive contracts and non-pending milestones', async () => {
    for (const user of [expert, admin]) {
      const { svc } = setup([{ rows: [contractRow()] }]);
      await assert.rejects(svc.fundMilestone('CT-1', MID, user), status(403));
    }
    const a = setup([{ rows: [contractRow({ status: 'pending_signature' })] }]);
    await assert.rejects(a.svc.fundMilestone('CT-1', MID, buyer), status(409));
    const b = setup([{ rows: [contractRow()] }, { rows: [milestoneRow({ status: 'funded' })] }]);
    await assert.rejects(b.svc.fundMilestone('CT-1', MID, buyer), status(409));
  });
});

describe('ContractsService.markPaymentCaptured', () => {
  const payment = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1', contract_id: 'CT-1', milestone_id: MID, amount: '400.00', currency: 'INR', provider: 'pending',
    provider_payment_id: null, status: 'pending', ...over,
  });

  it('captures: payment, milestone, escrow total and ledger hold in one transaction', async () => {
    const { svc, sql, params, sent } = setup([
      { rows: [payment()] }, { rows: [contractRow()] }, { rows: [payment()] }, { rows: [milestoneRow()] },
      { rows: [{ id: 'pay-1' }] }, { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] },
    ]);
    const out = await svc.markPaymentCaptured('pay_ABC', 'pay-1', 'admin:adm-1');
    assert.deepEqual(out, { paymentId: 'pay-1', milestoneId: MID, contractId: 'CT-1', amount: 400, alreadyCaptured: false });
    const commit = sql.indexOf('COMMIT');
    const cap = sql.findIndex((q) => /SET status = 'captured'/.test(q));
    const ms = sql.findIndex((q) => /SET status = 'funded'/.test(q));
    const esc = sql.findIndex((q) => /escrow_funded = escrow_funded \+ \$2/.test(q));
    const ledger = sql.findIndex((q) => /INSERT INTO ledger_entries/.test(q));
    for (const i of [cap, ms, esc, ledger]) assert.ok(i > 0 && i < commit);
    assert.deepEqual(params[cap], ['pay-1', 'pay_ABC']);
    assert.equal(params[ledger][3], 'Escrow hold');
    assert.equal(params[ledger][2], 'buyer-1');
    assert.equal(params[ledger][5], -400);
    assert.deepEqual(sent.map((s) => s.userId).sort(), ['buyer-1', 'exp-1']);
  });

  it('is idempotent for a replay with the same provider id', async () => {
    const captured = payment({ status: 'captured', provider_payment_id: 'pay_ABC' });
    const { svc, sql, sent } = setup([{ rows: [captured] }, { rows: [contractRow()] }, { rows: [captured] }]);
    const out = await svc.markPaymentCaptured('pay_ABC');
    assert.equal(out.alreadyCaptured, true);
    assert.ok(!sql.some((q) => /^\s*(UPDATE|INSERT)/.test(q)));
    assert.equal(sent.length, 0);
    assert.equal(sql.at(-1), 'COMMIT');
  });

  it('refuses a captured payment under a different provider id', async () => {
    const captured = payment({ status: 'captured', provider_payment_id: 'pay_ABC' });
    const { svc } = setup([{ rows: [captured] }, { rows: [contractRow()] }, { rows: [captured] }]);
    await assert.rejects(svc.markPaymentCaptured('pay_XYZ', 'pay-1'), status(409));
  });

  it('refuses a provider id already used by another payment (unique index)', async () => {
    const { svc, sql } = setup([
      { rows: [payment()] }, { rows: [contractRow()] }, { rows: [payment()] }, { rows: [milestoneRow()] },
      { error: uniqueViolation },
    ]);
    await assert.rejects(svc.markPaymentCaptured('pay_USED', 'pay-1'), status(409));
    assert.ok(!sql.some((q) => /ledger_entries/.test(q)));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  it('refuses a capture once the contract is cancelled or the payment failed', async () => {
    const a = setup([
      { rows: [payment()] }, { rows: [contractRow({ status: 'cancelled' })] }, { rows: [payment()] }, { rows: [milestoneRow()] },
    ]);
    await assert.rejects(a.svc.markPaymentCaptured('pay_ABC', 'pay-1'), status(409));
    const b = setup([{ rows: [payment()] }, { rows: [contractRow()] }, { rows: [payment({ status: 'failed' })] }]);
    await assert.rejects(b.svc.markPaymentCaptured('pay_ABC', 'pay-1'), status(409));
  });

  it('404s an unknown payment', async () => {
    const { svc } = setup([{ rows: [] }]);
    await assert.rejects(svc.markPaymentCaptured('pay_ABC'), status(404));
  });
});

// ─── Cancel ─────────────────────────────────────────────────────────────────

describe('ContractsService.cancel', () => {
  it('lets the buyer cancel before anything is funded', async () => {
    const { svc, sql, sent } = setup([
      { rows: [contractRow()] }, { rows: [{ moved: '0' }] }, { rows: [contractRow({ status: 'cancelled' })] },
      { rows: [] }, { rows: [] }, ...reload({ status: 'cancelled' }),
    ]);
    const out = await svc.cancel('CT-1', 'Changed plans', buyer);
    assert.equal(out.refundDue, 0);
    assert.ok(sql.some((q) => /UPDATE escrow_payments SET status = 'failed'/.test(q)));
    assert.deepEqual(sent.map((s) => s.userId), ['exp-1']);
  });

  it('refuses the buyer once money is in escrow or a milestone has moved', async () => {
    const a = setup([{ rows: [contractRow({ escrow_funded: '400.00' })] }, { rows: [{ moved: '1' }] }]);
    await assert.rejects(a.svc.cancel('CT-1', 'nope', buyer), status(409));
    const b = setup([{ rows: [contractRow()] }, { rows: [{ moved: '1' }] }]);
    await assert.rejects(b.svc.cancel('CT-1', 'nope', buyer), status(409));
    const c = setup([{ rows: [contractRow({ status: 'disputed' })] }]);
    await assert.rejects(c.svc.cancel('CT-1', 'nope', buyer), status(409));
  });

  it('lets an admin cancel a funded contract and reports the refund due', async () => {
    const { svc, sent } = setup([
      { rows: [contractRow({ escrow_funded: '1000.00', released: '400.00' })] },
      { rows: [contractRow({ status: 'cancelled', escrow_funded: '1000.00', released: '400.00' })] },
      { rows: [] }, { rows: [] }, ...reload({ status: 'cancelled' }),
    ]);
    const out = await svc.cancel('CT-1', 'Fraud review', admin);
    assert.equal(out.refundDue, 600);
    assert.deepEqual(sent.map((s) => s.userId).sort(), ['buyer-1', 'exp-1']);
  });

  it('refuses the expert and finished contracts', async () => {
    const a = setup([{ rows: [contractRow()] }]);
    await assert.rejects(a.svc.cancel('CT-1', 'nope', expert), status(403));
    for (const s of ['completed', 'cancelled']) {
      const b = setup([{ rows: [contractRow({ status: s })] }]);
      await assert.rejects(b.svc.cancel('CT-1', 'nope', admin), status(409));
    }
  });
});
