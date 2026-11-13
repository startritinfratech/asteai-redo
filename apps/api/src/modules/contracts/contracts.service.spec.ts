import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import type { NotificationsService } from '../notifications/notifications.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { EmailService } from '../email/email.service';
import { PaymentProviderError, type ProviderRefund, type RefundInput } from '../payments/payment-provider';
import type { OpenOrderInput, PaymentsService } from '../payments/payments.service';
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

/** PaymentsService stand-in: records orders and refunds; `refund` answers with `refundReply`. */
function fakePayments(opts: {
  configured?: boolean; orderError?: Error; refundReply?: (input: RefundInput) => ProviderRefund | Error; reused?: boolean;
} = {}) {
  const orders: OpenOrderInput[] = [];
  const refunds: RefundInput[] = [];
  const svc = {
    assertConfigured: () => {
      if (opts.configured === false) throw new ServiceUnavailableException('Payments are not configured');
    },
    openOrder: async (input: OpenOrderInput) => {
      orders.push(input);
      if (opts.orderError) throw opts.orderError;
      return { orderId: 'order_1', amountMinor: input.amountMinor, currency: input.currency, keyId: 'rzp_test_key', reused: Boolean(opts.reused) };
    },
    refund: async (input: RefundInput) => {
      refunds.push(input);
      const out = opts.refundReply?.(input) ?? { id: `rfnd_${refunds.length}`, amountMinor: input.amountMinor, status: 'pending' };
      if (out instanceof Error) throw out;
      return out;
    },
    registerPurpose: () => undefined,
    registerRefundHandler: () => undefined,
  } as unknown as PaymentsService;
  return { svc, orders, refunds };
}

function fakeEmail() {
  const queued: { template: string; to: string; data: unknown; dedupeKey?: string }[] = [];
  const svc = {
    enqueue: async (template: string, to: string, data: unknown, opts: { dedupeKey?: string } = {}) => {
      queued.push({ template, to, data, dedupeKey: opts.dedupeKey });
      return 'mail-1';
    },
  } as unknown as EmailService;
  return { svc, queued };
}

/** Records invoice requests; the real service is tested in invoices.service.spec.ts. */
function fakeInvoices() {
  const invoiced: { escrowPaymentId: string; inTransaction: boolean }[] = [];
  const svc = {
    createForCapturedPayment: async (escrowPaymentId: string, client?: unknown) => {
      invoiced.push({ escrowPaymentId, inTransaction: client !== undefined });
      return { id: 'INV-2026-000001' };
    },
  } as unknown as InvoicesService;
  return { svc, invoiced };
}

function setup(replies: Reply[], payOpts: Parameters<typeof fakePayments>[0] = {}) {
  const db = fakePool(replies);
  const n = fakeNotifications();
  const pay = fakePayments(payOpts);
  const mail = fakeEmail();
  const inv = fakeInvoices();
  return {
    ...db, sent: n.sent, orders: pay.orders, refunds: pay.refunds, queued: mail.queued, invoiced: inv.invoiced,
    svc: new ContractsService(db.pool, n.svc, pay.svc, mail.svc, inv.svc),
  };
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
  cancelled_by: null, cancel_reason: null, refund_due: '0.00', source: 'app', created_at: new Date(), updated_at: new Date(),
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

/** Replies for reopenProject() when no money moved: no captured payment, project locked, proposals and project updated. */
const reopenReplies = (): Reply[] => [{ rows: [] }, { rows: [{ title: 'Proj' }] }, { rows: [] }, { rows: [{ id: 'PRJ-1' }] }];
function assertReopened(sql: string[], params: unknown[][], proposalStatus: string) {
  const proposals = sql.findIndex((q) => /UPDATE proposals/.test(q));
  assert.ok(proposals > 0, 'the proposals were updated');
  assert.equal(params[proposals][2], proposalStatus);
  assert.ok(sql.some((q) => /UPDATE projects SET awarded_to = NULL, stage = 'Open for Bids'/.test(q)));
}

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
    const { svc, sql, params, sent } = setup([
      { rows: [contractRow({ status: 'pending_signature' })] }, { rows: [contractRow({ status: 'cancelled' })] }, { rows: [] },
      ...reopenReplies(), ...reload({ status: 'cancelled' }),
    ]);
    await svc.decline('CT-1', 'Busy', expert);
    assert.ok(sql.some((q) => /SET status = 'cancelled'/.test(q)));
    assertReopened(sql, params, 'Declined');
    assert.deepEqual(sent.map((s) => s.userId), ['buyer-1', 'buyer-1']);
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
    const { svc, sql, params, orders } = setup([
      { rows: [contractRow()] }, { rows: [milestoneRow()] }, { rows: [] },
      { rows: [{ id: 'pay-1', amount: '400.00', currency: 'INR', provider: 'razorpay', status: 'pending' }] },
    ]);
    const out = await svc.fundMilestone('CT-1', MID, buyer);
    assert.deepEqual(out, {
      paymentId: 'pay-1', orderId: 'order_1', amount: 400, amountMinor: 40000, currency: 'INR', keyId: 'rzp_test_key',
      provider: 'razorpay', status: 'pending',
    });
    const insert = sql.findIndex((q) => /INSERT INTO escrow_payments/.test(q));
    assert.equal(params[insert][2], '400.00'); // amount from the milestone, never from the browser
    assert.equal(orders[0].amountMinor, 40000);
    assert.equal(orders[0].purpose, 'escrow_milestone');
    assert.ok(sql.indexOf('COMMIT') < sql.findIndex((q) => /UPDATE escrow_payments SET provider = 'razorpay'/.test(q)));
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
    const { svc, sql, params, sent } = setup([
      { rows: [contractRow()] }, { rows: [{ moved: '0' }] }, { rows: [contractRow({ status: 'cancelled' })] },
      { rows: [] }, { rows: [] }, ...reopenReplies(), ...reload({ status: 'cancelled' }),
    ]);
    const out = await svc.cancel('CT-1', 'Changed plans', buyer);
    assert.equal(out.refundDue, 0);
    assert.ok(sql.some((q) => /UPDATE escrow_payments SET status = 'failed'/.test(q)));
    // Owed back: what is still held, less refunds already processed (e.g. after a dispute).
    const cancelSql = sql.find((q) => /UPDATE contracts/.test(q)) ?? '';
    assert.match(cancelSql, /refund_due = GREATEST\(escrow_funded - released - \(/);
    assertReopened(sql, params, 'Withdrawn');
    assert.deepEqual(sent.map((s) => s.userId), ['exp-1', 'buyer-1']);
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
    const funded = { escrow_funded: '1000.00', released: '400.00' };
    const { svc, sql, sent } = setup([
      { rows: [contractRow(funded)] },
      { rows: [contractRow({ status: 'cancelled', refund_due: '600.00', ...funded })] },
      { rows: [] }, { rows: [] }, { rows: [] }, ...reload({ status: 'cancelled', refund_due: '600.00', ...funded }),
    ]);
    const out = await svc.cancel('CT-1', 'Fraud review', admin);
    assert.equal(out.refundDue, 600);
    assert.ok(sql.some((q) => /Contract cancelled with refund due/.test(q)), 'audited');
    assert.ok(!sql.some((q) => /UPDATE (proposals|projects)/.test(q)), 'money moved: the project stays awarded');
    assert.deepEqual(sent.map((s) => s.userId).sort(), ['buyer-1', 'buyer-1', 'exp-1']);
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

// ─── Gig contracts (no project, no proposal) ────────────────────────────────

describe('gig contracts without a project', () => {
  const gigRow = (over: Record<string, unknown> = {}) => contractRow({
    project_id: null, proposal_id: null, source: 'gig', gig_order_id: 'ORD-1', title: 'Security audit',
    project_title: null, display_title: 'Security audit', ...over,
  });

  it('reads through a LEFT JOIN on projects and titles the contract with the gig title', async () => {
    const { svc, sql } = setup([{ rows: [gigRow()] }, { rows: [milestoneRow()] }]);
    const out = await svc.findOne('CT-1', buyer);
    assert.match(sql[0], /LEFT JOIN projects pj ON pj\.id = c\.project_id/);
    assert.match(sql[0], /COALESCE\(pj\.title, c\.title\)/);
    assert.equal(out.projectId, null);
    assert.equal(out.projectTitle, null);
    assert.equal(out.proposalId, null);
    assert.equal(out.title, 'Security audit');
    assert.equal(out.gigOrderId, 'ORD-1');
    assert.equal(out.source, 'gig');
  });

  it('a project contract keeps its project title', async () => {
    const { svc } = setup([{ rows: [contractRow({ display_title: 'Proj' })] }, { rows: [milestoneRow()] }]);
    const out = await svc.findOne('CT-1', buyer);
    assert.equal(out.title, 'Proj');
    assert.equal(out.projectId, 'PRJ-1');
  });

  it('the buyer cancels an unpaid gig contract without touching projects or proposals', async () => {
    const { svc, sql } = setup([
      { rows: [gigRow()] }, { rows: [{ moved: '0' }] }, { rows: [gigRow({ status: 'cancelled' })] }, { rows: [] }, { rows: [] },
      ...reload({ status: 'cancelled', project_id: null, proposal_id: null, source: 'gig' }),
    ]);
    const out = await svc.cancel('CT-1', 'Changed my mind', buyer);
    assert.equal(out.status, 'cancelled');
    assert.ok(!sql.some((q) => /UPDATE (projects|proposals)|FROM (projects|proposals)/.test(q)));
  });

  it('releasing the only milestone completes the gig contract; the project update joins nothing', async () => {
    const { svc, sql } = setup([
      { rows: [gigRow({ escrow_funded: '1000.00' })] }, { rows: [milestoneRow({ status: 'accepted', amount: '1000.00' })] },
      { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ open: '0' }] }, { rows: [] },
      ...reload({ status: 'completed', project_id: null, source: 'gig' }),
    ]);
    await svc.releaseMilestone('CT-1', MID, buyer);
    const done = sql.find((q) => /SET status = 'completed'/.test(q)) ?? '';
    // project_id comes from the completed contract row; NULL matches no project.
    assert.match(done, /RETURNING project_id/);
    assert.match(done, /pj\.id = done\.project_id/);
  });

  it('funding a gig milestone needs no project either (capture, ledger and escrow only)', async () => {
    const pay = { id: 'PAY-1', contract_id: 'CT-1', milestone_id: MID, amount: '400.00', currency: 'INR', provider: 'razorpay', provider_payment_id: null, status: 'pending' };
    const { svc, sql } = setup([
      { rows: [pay] }, { rows: [gigRow()] }, { rows: [pay] }, { rows: [milestoneRow()] },
      { rows: [{ id: 'PAY-1' }] }, { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] },
    ]);
    const out = await svc.markPaymentCaptured('pay_1', 'PAY-1');
    assert.equal(out.alreadyCaptured, false);
    assert.ok(sql.some((q) => /INSERT INTO ledger_entries/.test(q)));
    assert.ok(!sql.some((q) => /FROM projects|UPDATE projects/.test(q)));
  });
});

// ─── Refunds ────────────────────────────────────────────────────────────────

describe('ContractsService.issueRefund', () => {
  const REFUND_ID = '22222222-2222-4222-8222-222222222222';
  const due = (over: Record<string, unknown> = {}) => contractRow({ status: 'cancelled', refund_due: '600.00', escrow_funded: '1000.00', ...over });
  const refundRow = (over: Record<string, unknown> = {}) => ({
    id: REFUND_ID, contract_id: 'CT-1', escrow_payment_id: 'pa', amount: '400.00', currency: 'INR', provider_refund_id: null,
    status: 'pending', reason: 'Fraud review', error: null, created_at: new Date(), processed_at: null, ...over,
  });
  const payments = [
    { id: 'pa', amount: '400.00', currency: 'INR', provider_payment_id: 'pay_a', refunded: '0' },
    { id: 'pb', amount: '600.00', currency: 'INR', provider_payment_id: 'pay_b', refunded: '100.00' },
  ];

  it('reserves the refund due across captured payments, then calls Razorpay after COMMIT', async () => {
    const { svc, sql, refunds } = setup([
      { rows: [due()] }, { rows: [{ reserved: '0' }] }, { rows: payments },
      { rows: [refundRow()] }, { rows: [refundRow({ id: 'r2', escrow_payment_id: 'pb', amount: '200.00' })] }, { rows: [] },
    ]);
    await svc.issueRefund('CT-1', { reason: 'Fraud review' }, admin);
    const commit = sql.indexOf('COMMIT');
    assert.ok(sql.findIndex((q) => /INSERT INTO refunds/.test(q)) < commit);
    assert.ok(sql.findIndex((q) => /INSERT INTO audit_log/.test(q)) < commit);
    assert.deepEqual(refunds.map((r) => [r.paymentId, r.amountMinor]), [['pay_a', 40000], ['pay_b', 20000]]);
    assert.ok(sql.findIndex((q) => /UPDATE refunds SET provider_refund_id/.test(q)) > commit);
  });

  it('refuses non-admins, contracts that owe nothing and unconfigured payments', async () => {
    await assert.rejects(setup([]).svc.issueRefund('CT-1', { reason: 'x y z' }, buyer), status(403));
    await assert.rejects(setup([{ rows: [contractRow({ refund_due: '0.00' })] }]).svc.issueRefund('CT-1', { reason: 'x y z' }, admin), status(409));
    await assert.rejects(setup([], { configured: false }).svc.issueRefund('CT-1', { reason: 'x y z' }, admin), status(503));
  });

  it('only refunds what is not already reserved by pending refunds', async () => {
    const t = setup([{ rows: [due()] }, { rows: [{ reserved: '600.00' }] }]);
    await assert.rejects(t.svc.issueRefund('CT-1', { reason: 'again' }, admin), status(409));
    const u = setup([{ rows: [due()] }, { rows: [{ reserved: '500.00' }] }]);
    await assert.rejects(u.svc.issueRefund('CT-1', { reason: 'too much', amount: 200 }, admin), status(400));
  });

  it('refuses when the money was not paid through Razorpay', async () => {
    const t = setup([{ rows: [due()] }, { rows: [{ reserved: '0' }] }, { rows: [] }]);
    await assert.rejects(t.svc.issueRefund('CT-1', { reason: 'manual' }, admin), status(409));
  });

  it('a refused provider call fails the row; an unknown outcome keeps it pending', async () => {
    const rejected = setup([
      { rows: [due({ refund_due: '400.00' })] }, { rows: [{ reserved: '0' }] }, { rows: [payments[0]] }, { rows: [refundRow()] }, { rows: [] },
    ], { refundReply: () => new PaymentProviderError('bad request', 'rejected', 400) });
    await rejected.svc.issueRefund('CT-1', { reason: 'Fraud review' }, admin);
    assert.ok(rejected.sql.some((q) => /UPDATE refunds SET status = 'failed'/.test(q)));

    const unknown = setup([
      { rows: [due({ refund_due: '400.00' })] }, { rows: [{ reserved: '0' }] }, { rows: [payments[0]] }, { rows: [refundRow()] }, { rows: [] },
    ], { refundReply: () => new PaymentProviderError('timeout', 'unavailable') });
    await unknown.svc.issueRefund('CT-1', { reason: 'Fraud review' }, admin);
    assert.ok(!unknown.sql.some((q) => /SET status = 'failed'/.test(q)));
    assert.match(JSON.stringify(unknown.params), /Outcome unknown/);
  });
});

describe('ContractsService.applyRefundEvent', () => {
  const REFUND_ID = '22222222-2222-4222-8222-222222222222';
  const refund = (over: Record<string, unknown> = {}) => ({
    id: REFUND_ID, contract_id: 'CT-1', escrow_payment_id: 'pa', amount: '400.00', currency: 'INR',
    provider_refund_id: 'rfnd_1', status: 'pending', reason: 'Fraud review', error: null, ...over,
  });
  const event = { providerRefundId: 'rfnd_1', status: 'processed' as const, actor: 'razorpay-webhook' };

  it('processed: marks the refund, lowers refund_due, writes a Refund ledger row and emails the buyer, once', async () => {
    const { svc, sql, params, queued, sent } = setup([
      { rows: [refund()] }, { rows: [contractRow({ status: 'cancelled', refund_due: '600.00' })] }, { rows: [refund()] },
      { rows: [{ id: REFUND_ID }] }, { rows: [] }, { rows: [] }, { rows: [{ email: 'b@example.com', first_name: 'Bina' }] },
    ]);
    await svc.applyRefundEvent(event);
    const commit = sql.indexOf('COMMIT');
    const ledger = sql.findIndex((q) => /INSERT INTO ledger_entries/.test(q));
    assert.ok(ledger > 0 && ledger < commit);
    assert.match(sql.find((q) => /UPDATE contracts SET refund_due/.test(q)) ?? '', /GREATEST\(refund_due - \$2, 0\)/);
    assert.equal(params[ledger][3], 'Refund');
    assert.equal(params[ledger][5], 400);
    assert.deepEqual(queued.map((q) => q.template), ['refund-issued']);
    assert.equal(sent[0].userId, 'buyer-1');
  });

  it('a replayed processed event changes nothing', async () => {
    const { svc, sql, sent } = setup([
      { rows: [refund({ status: 'processed' })] }, { rows: [contractRow()] }, { rows: [refund({ status: 'processed' })] },
    ]);
    await svc.applyRefundEvent(event);
    assert.ok(!sql.some((q) => /^\s*(UPDATE|INSERT)/.test(q)));
    assert.equal(sent.length, 0);
  });

  it('failed: marks a pending refund failed without touching the ledger or refund_due', async () => {
    const { svc, sql } = setup([{ rows: [refund()] }, { rows: [contractRow()] }, { rows: [refund()] }]);
    await svc.applyRefundEvent({ ...event, status: 'failed', error: 'bank declined' });
    assert.ok(sql.some((q) => /UPDATE refunds SET status = 'failed'/.test(q)));
    assert.ok(!sql.some((q) => /ledger_entries|refund_due/.test(q)));
  });

  it('ignores refunds we did not issue, and refuses a provider id that belongs to another refund', async () => {
    const { svc, sql } = setup([{ rows: [] }]);
    await svc.applyRefundEvent(event);
    assert.ok(!sql.some((q) => /^\s*(UPDATE|INSERT)/.test(q)));
    const other = setup([{ rows: [refund()] }, { rows: [contractRow()] }, { rows: [refund({ provider_refund_id: 'rfnd_other' })] }]);
    await assert.rejects(other.svc.applyRefundEvent(event), status(409));
  });
});

describe('checkout verify and webhook racing for one payment', () => {
  it('the second capture is a no-op: one ledger hold, one invoice', async () => {
    const pending = { id: 'pay-1', contract_id: 'CT-1', milestone_id: MID, amount: '400.00', currency: 'INR', provider: 'razorpay', provider_payment_id: null, status: 'pending' };
    const captured = { ...pending, status: 'captured', provider_payment_id: 'pay_ABC' };
    const first = setup([
      { rows: [pending] }, { rows: [contractRow()] }, { rows: [pending] }, { rows: [milestoneRow()] },
      { rows: [{ id: 'pay-1' }] }, { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] },
    ]);
    const a = await first.svc.markPaymentCaptured('pay_ABC', 'pay-1');
    assert.equal(a.alreadyCaptured, false);
    const second = setup([{ rows: [captured] }, { rows: [contractRow()] }, { rows: [captured] }]);
    const b = await second.svc.markPaymentCaptured('pay_ABC', 'pay-1');
    assert.equal(b.alreadyCaptured, true);
    assert.equal(first.sql.filter((q) => /INSERT INTO ledger_entries/.test(q)).length, 1);
    assert.equal(second.sql.filter((q) => /INSERT INTO ledger_entries/.test(q)).length, 0);
    assert.deepEqual(first.invoiced.map((i) => i.escrowPaymentId), ['pay-1']);
  });

  it('an invoice failure never undoes the funding: the capture result is still returned', async () => {
    const pending = { id: 'pay-1', contract_id: 'CT-1', milestone_id: MID, amount: '400.00', currency: 'INR', provider: 'razorpay', provider_payment_id: null, status: 'pending' };
    const t = setup([
      { rows: [pending] }, { rows: [contractRow()] }, { rows: [pending] }, { rows: [milestoneRow()] },
      { rows: [{ id: 'pay-1' }] }, { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] },
    ]);
    (t.svc as unknown as { invoices: { createForCapturedPayment: () => Promise<never> } }).invoices = {
      createForCapturedPayment: async () => { throw new Error('boom'); },
    };
    const out = await t.svc.markPaymentCaptured('pay_ABC', 'pay-1');
    assert.equal(out.alreadyCaptured, false);
  });
});

// ─── Edge cases around capture, decline, cancel and refunds ─────────────────
// (Added when the spec was rebuilt: no earlier copy of the lost tests could be recovered.)

describe('payment capture on disputed and cancelled contracts', () => {
  const pay = (over: Record<string, unknown> = {}) => ({
    id: 'pay-1', contract_id: 'CT-1', milestone_id: MID, amount: '400.00', currency: 'INR', provider: 'razorpay',
    provider_payment_id: null, status: 'pending', ...over,
  });

  it('a payment started before a dispute is still captured into escrow (disputed contract)', async () => {
    const { svc, sql } = setup([
      { rows: [pay()] }, { rows: [contractRow({ status: 'disputed' })] }, { rows: [pay()] }, { rows: [milestoneRow()] },
      { rows: [{ id: 'pay-1' }] }, { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] },
    ]);
    const out = await svc.markPaymentCaptured('pay_ABC', 'pay-1');
    assert.equal(out.alreadyCaptured, false);
    const esc = sql.find((q) => /escrow_funded = escrow_funded \+ \$2/.test(q)) ?? '';
    assert.match(esc, /status IN \('active', 'disputed'\)/);
    assert.ok(sql.some((q) => /INSERT INTO ledger_entries/.test(q)));
    assert.equal(sql.at(-1), 'COMMIT');
  });

  it('a cancelled (or completed) contract refuses the capture and writes nothing: the payments layer refunds it', async () => {
    for (const s of ['cancelled', 'completed']) {
      const { svc, sql } = setup([
        { rows: [pay()] }, { rows: [contractRow({ status: s })] }, { rows: [pay()] }, { rows: [milestoneRow()] },
      ]);
      await assert.rejects(svc.markPaymentCaptured('pay_ABC', 'pay-1'), (e: HttpException) => e.getStatus() === 409 && /needs a refund/.test(e.message), s);
      assert.ok(!sql.some((q) => /^s*(UPDATE|INSERT)/.test(q)), s);
      assert.equal(sql.at(-1), 'ROLLBACK');
    }
  });
});

describe('decline and cancel leave the project alone when they must', () => {
  it('decline does not touch a project that was already reopened or awarded to someone else', async () => {
    const { svc, sql, sent } = setup([
      { rows: [contractRow({ status: 'pending_signature' })] }, { rows: [contractRow({ status: 'cancelled' })] }, { rows: [] },
      { rows: [] }, // no captured payment
      { rows: [] }, // SELECT ... FROM projects WHERE awarded_to = expert: nothing (already reopened)
      ...reload({ status: 'cancelled' }),
    ]);
    await svc.decline('CT-1', 'Busy', expert);
    assert.ok(sql.some((q) => /FROM projects WHERE id = \$1 AND awarded_to = \$2 FOR UPDATE/.test(q)));
    assert.ok(!sql.some((q) => /UPDATE (proposals|projects)/.test(q)));
    assert.deepEqual(sent.map((s) => s.userId), ['buyer-1'], 'only the decline notice, no "open for bids" one');
  });

  it('a captured escrow payment keeps the project awarded when the buyer cancels', async () => {
    const { svc, sql } = setup([
      { rows: [contractRow()] }, { rows: [{ moved: '0' }] }, { rows: [contractRow({ status: 'cancelled' })] },
      { rows: [] }, { rows: [] },
      { rows: [{ '?column?': 1 }] }, // a captured payment exists (capture raced the cancel)
      ...reload({ status: 'cancelled' }),
    ]);
    await svc.cancel('CT-1', 'Changed plans', buyer);
    assert.ok(sql.some((q) => /FROM escrow_payments WHERE contract_id = \$1 AND status = 'captured'/.test(q)));
    assert.ok(!sql.some((q) => /FROM projects|UPDATE (proposals|projects)/.test(q)), 'the project stays awarded');
  });

  it('money released or funded keeps the project awarded without even looking for payments', async () => {
    const { svc, sql } = setup([
      { rows: [contractRow({ released: '100.00', escrow_funded: '100.00' })] },
      { rows: [contractRow({ status: 'cancelled', released: '100.00', escrow_funded: '100.00' })] },
      { rows: [] }, { rows: [] }, ...reload({ status: 'cancelled' }),
    ]);
    await svc.cancel('CT-1', 'Fraud review', admin);
    assert.ok(!sql.some((q) => /FROM escrow_payments WHERE contract_id = \$1 AND status = 'captured'/.test(q)));
    assert.ok(!sql.some((q) => /UPDATE (proposals|projects)/.test(q)));
  });

  it('a buyer can not cancel once a milestone is funded, even if escrow_funded is still 0 (and the update never runs)', async () => {
    const { svc, sql } = setup([{ rows: [contractRow()] }, { rows: [{ moved: '1' }] }]);
    await assert.rejects(svc.cancel('CT-1', 'nope', buyer), status(409));
    assert.ok(!sql.some((q) => /SET status = 'cancelled'/.test(q)));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  it('an admin cancel sets refund_due = GREATEST(funded - released - processed refunds, 0) in the same UPDATE', async () => {
    const funded = { escrow_funded: '1000.00', released: '300.00' };
    const { svc, sql, params } = setup([
      { rows: [contractRow(funded)] },
      { rows: [contractRow({ status: 'cancelled', refund_due: '500.00', ...funded })] },
      { rows: [] }, { rows: [] }, { rows: [] }, ...reload({ status: 'cancelled', refund_due: '500.00', ...funded }),
    ]);
    const out = await svc.cancel('CT-1', 'Fraud review', admin);
    assert.equal(out.refundDue, 500);
    const i = sql.findIndex((q) => /SET status = 'cancelled', cancelled_by/.test(q));
    assert.match(sql[i], /refund_due = GREATEST\(escrow_funded - released - \(\s*SELECT COALESCE\(SUM\(r\.amount\), 0\) FROM refunds r WHERE r\.contract_id = \$1 AND r\.status = 'processed'\s*\), 0\)/);
    assert.deepEqual(params[i], ['CT-1', 'adm-1', 'Fraud review', 'active']);
  });
});

describe('ContractsService.issueRefund on a resolved dispute', () => {
  const refundRow = (id: string, amount: string) => ({
    id, contract_id: 'CT-1', escrow_payment_id: 'pa', amount, currency: 'INR', provider_refund_id: null,
    status: 'pending', reason: 'Dispute DSP-1', error: null, created_at: new Date(), processed_at: null,
  });
  const captured = [{ id: 'pa', amount: '1000.00', currency: 'INR', provider_payment_id: 'pay_a', refunded: '0' }];

  it('works on an active contract (a dispute was resolved in the buyer\'s favour) and refunds the whole due amount', async () => {
    const { svc, refunds } = setup([
      { rows: [contractRow({ status: 'active', refund_due: '400.00', escrow_funded: '1000.00' })] },
      { rows: [{ reserved: '0' }] }, { rows: captured }, { rows: [refundRow('r1', '400.00')] }, { rows: [] },
    ]);
    await svc.issueRefund('CT-1', { reason: 'Dispute DSP-1' }, admin);
    assert.deepEqual(refunds.map((r) => [r.paymentId, r.amountMinor]), [['pay_a', 40000]]);
  });

  it('is capped by pending reservations: the default amount is what is unreserved, and asking for more is refused', async () => {
    const t = setup([
      { rows: [contractRow({ status: 'active', refund_due: '600.00' })] },
      { rows: [{ reserved: '200.00' }] }, { rows: captured }, { rows: [refundRow('r1', '400.00')] }, { rows: [] },
    ]);
    await t.svc.issueRefund('CT-1', { reason: 'rest' }, admin);
    assert.deepEqual(t.refunds.map((r) => r.amountMinor), [40000]);
    const over = setup([{ rows: [contractRow({ status: 'active', refund_due: '600.00' })] }, { rows: [{ reserved: '200.00' }] }]);
    await assert.rejects(over.svc.issueRefund('CT-1', { reason: 'rest', amount: 450 }, admin), status(400));
    assert.equal(over.refunds.length, 0);
  });
});

// ─── Dispute helpers (DisputesService runs these in its own transaction) ─────

describe('dispute helpers', () => {
  async function withClient(replies: Reply[]) {
    const t = setup(replies);
    const client = await t.pool.connect();
    return { ...t, client };
  }
  const ledgerRows = (sql: string[], params: unknown[][]) =>
    sql.flatMap((q, i) => (/INSERT INTO ledger_entries/.test(q) ? [params[i]] : []));
  const held = { escrow_funded: '400.00', status: 'disputed' };

  it('lockForDispute locks the contract row', async () => {
    const t = await withClient([{ rows: [contractRow()] }]);
    const row = await t.svc.lockForDispute(t.client, 'CT-1');
    assert.equal(row.id, 'CT-1');
    assert.match(t.sql[0], /FROM contracts WHERE id = \$1 FOR UPDATE/);
    const none = await withClient([{ rows: [] }]);
    await assert.rejects(none.svc.lockForDispute(none.client, 'CT-9'), status(404));
  });

  it('freezeForDispute: active -> disputed; already disputed is a no-op; anything else is refused', async () => {
    const a = await withClient([{ rows: [{ id: 'CT-1' }] }]);
    await a.svc.freezeForDispute(a.client, contractRow() as never);
    assert.match(a.sql[0], /SET status = 'disputed'[\s\S]*status = 'active'/);
    const b = await withClient([]);
    await b.svc.freezeForDispute(b.client, contractRow({ status: 'disputed' }) as never);
    assert.equal(b.sql.length, 0);
    const c = await withClient([]);
    await assert.rejects(c.svc.freezeForDispute(c.client, contractRow({ status: 'cancelled' }) as never), status(409));
    const d = await withClient([{ rows: [] }]);
    await assert.rejects(d.svc.freezeForDispute(d.client, contractRow() as never), status(409));
  });

  it('settleMilestoneByAdmin split: releases the expert share (released total + ledger) and adds the buyer share to refund_due', async () => {
    const t = await withClient([
      { rows: [contractRow(held)] }, { rows: [milestoneRow({ status: 'submitted' })] },
      { rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ id: 'CT-1' }] }, { rows: [{ id: MID }] },
    ]);
    const out = await t.svc.settleMilestoneByAdmin(t.client, 'CT-1', MID, { toExpert: 150, toBuyer: 250 }, admin, 'DSP-1');
    assert.deepEqual(out, { toExpert: 150, toBuyer: 250 });
    const rel = t.sql.findIndex((q) => /SET released = released \+ \$2/.test(q));
    assert.equal(t.params[rel][1], 150);
    assert.match(t.sql[rel], /status = \$3 AND released \+ \$2 <= escrow_funded/);
    assert.equal(t.params[rel][2], 'disputed');
    const [ledger] = ledgerRows(t.sql, t.params);
    assert.deepEqual([ledger[2], ledger[3], ledger[5], ledger[8]], ['exp-1', 'Escrow release', 150, 'adm-1']);
    assert.match(String(ledger[4]), /dispute DSP-1/);
    const due = t.sql.findIndex((q) => /SET refund_due = refund_due \+ \$2/.test(q));
    assert.equal(t.params[due][1], 250);
    const ms = t.sql.find((q) => /UPDATE contract_milestones/.test(q)) ?? '';
    assert.match(ms, /status = 'released'/);
  });

  it('settleMilestoneByAdmin full refund: no release, no ledger row, refund_due grows, milestone cancelled', async () => {
    const t = await withClient([
      { rows: [contractRow(held)] }, { rows: [milestoneRow({ status: 'funded' })] }, { rows: [{ id: 'CT-1' }] }, { rows: [{ id: MID }] },
    ]);
    await t.svc.settleMilestoneByAdmin(t.client, 'CT-1', MID, { toExpert: 0, toBuyer: 400 }, admin, 'DSP-1');
    assert.equal(ledgerRows(t.sql, t.params).length, 0);
    assert.ok(!t.sql.some((q) => /SET released = released/.test(q)));
    assert.equal(t.params[t.sql.findIndex((q) => /refund_due = refund_due \+ \$2/.test(q))][1], 400);
    assert.match(t.sql.find((q) => /UPDATE contract_milestones/.test(q)) ?? '', /status = 'cancelled'/);
  });

  it('releaseByAdmin releases the whole milestone to the expert', async () => {
    const t = await withClient([
      { rows: [milestoneRow({ status: 'submitted' })] },
      { rows: [contractRow(held)] }, { rows: [milestoneRow({ status: 'submitted' })] },
      { rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ id: MID }] },
    ]);
    const out = await t.svc.releaseByAdmin('CT-1', MID, admin, t.client, 'DSP-1');
    assert.deepEqual(out, { toExpert: 400, toBuyer: 0 });
    assert.ok(!t.sql.some((q) => /refund_due = refund_due/.test(q)));
  });

  it('settleMilestoneByAdmin refuses a share that does not add up, a milestone with nothing held, and a contract that is not disputed', async () => {
    const a = await withClient([{ rows: [contractRow(held)] }, { rows: [milestoneRow({ status: 'submitted' })] }]);
    await assert.rejects(a.svc.settleMilestoneByAdmin(a.client, 'CT-1', MID, { toExpert: 100, toBuyer: 100 }, admin, 'DSP-1'), status(400));
    assert.equal(ledgerRows(a.sql, a.params).length, 0);
    const b = await withClient([{ rows: [contractRow(held)] }, { rows: [milestoneRow({ status: 'pending' })] }]);
    await assert.rejects(b.svc.settleMilestoneByAdmin(b.client, 'CT-1', MID, { toExpert: 400, toBuyer: 0 }, admin, 'DSP-1'), status(409));
    const c = await withClient([{ rows: [contractRow({ status: 'active' })] }]);
    await assert.rejects(c.svc.settleMilestoneByAdmin(c.client, 'CT-1', MID, { toExpert: 400, toBuyer: 0 }, admin, 'DSP-1'), status(409));
  });

  it('restoreAfterDispute: back to active while milestones remain, completed when every one is settled, unchanged when no longer disputed', async () => {
    const active = await withClient([{ rows: [contractRow({ status: 'disputed' })] }, { rows: [{ open: '1' }] }, { rows: [{ id: 'CT-1' }] }]);
    assert.equal(await active.svc.restoreAfterDispute(active.client, 'CT-1'), 'active');
    assert.match(active.sql.at(-1) ?? '', /SET status = 'active'[\s\S]*status = 'disputed'/);
    const done = await withClient([{ rows: [contractRow({ status: 'disputed' })] }, { rows: [{ open: '0' }] }, { rows: [] }]);
    assert.equal(await done.svc.restoreAfterDispute(done.client, 'CT-1'), 'completed');
    assert.match(done.sql.at(-1) ?? '', /SET status = 'completed'[\s\S]*UPDATE projects pj SET stage = 'Completed'/);
    assert.ok(!done.sql.some((q) => /SET status = 'active'/.test(q)));
    const cancelled = await withClient([{ rows: [contractRow({ status: 'cancelled' })] }]);
    assert.equal(await cancelled.svc.restoreAfterDispute(cancelled.client, 'CT-1'), 'cancelled');
    assert.equal(cancelled.sql.length, 1);
  });
});

// ─── Auto-accept (gig sweep) ────────────────────────────────────────────────

describe('ContractsService.autoAcceptAndRelease', () => {
  const gig = { source: 'gig', project_id: null, proposal_id: null, escrow_funded: '400.00' };

  it('accepts and releases in one transaction: system ledger row, completion and an audit row', async () => {
    const { svc, sql, params } = setup([
      { rows: [contractRow(gig)] }, { rows: [milestoneRow({ status: 'submitted' })] },
      { rows: [{ id: MID }] }, { rows: [{ id: MID }] }, { rows: [{ id: 'CT-1' }] }, { rows: [] }, { rows: [{ open: '0' }] }, { rows: [] }, { rows: [] },
    ]);
    assert.equal(await svc.autoAcceptAndRelease('CT-1', MID, 'no reply in 7 days'), true);
    const begin = sql.indexOf('BEGIN');
    const commit = sql.indexOf('COMMIT');
    const accepted = sql.findIndex((q) => /SET status = 'accepted'/.test(q));
    const released = sql.findIndex((q) => /SET status = 'released'/.test(q));
    const total = sql.findIndex((q) => /SET released = released \+ \$2/.test(q));
    const ledger = sql.findIndex((q) => /INSERT INTO ledger_entries/.test(q));
    const done = sql.findIndex((q) => /SET status = 'completed'/.test(q));
    const audit = sql.findIndex((q) => /INSERT INTO audit_log/.test(q));
    assert.ok(begin < accepted && accepted < released && released < total && total < ledger && ledger < done && done < audit && audit < commit);
    assert.equal(params[total][1], '400.00');
    const l = params[ledger];
    assert.deepEqual([l[2], l[3], l[5], l[6], l[7], l[8]], ['exp-1', 'Escrow release', 400, 'INR', 'exp-1', 'system:gig-auto-accept']);
    assert.match(sql[audit], /'Gig order auto-accepted'/);
    assert.equal(params[audit][0], 'contract:CT-1');
    assert.match(String(params[audit][1]), /no reply in 7 days/);
  });

  it('does nothing when the contract is disputed (or otherwise not active)', async () => {
    for (const s of ['disputed', 'cancelled', 'completed']) {
      const { svc, sql } = setup([{ rows: [contractRow({ ...gig, status: s })] }]);
      assert.equal(await svc.autoAcceptAndRelease('CT-1', MID, 'x'), false, s);
      assert.ok(!sql.some((q) => /^s*(UPDATE|INSERT)/.test(q)), s);
    }
  });

  it('does nothing when the buyer already accepted, released or asked for a revision', async () => {
    for (const s of ['accepted', 'released', 'revision_requested', 'funded']) {
      const { svc, sql } = setup([{ rows: [contractRow(gig)] }, { rows: [milestoneRow({ status: s })] }]);
      assert.equal(await svc.autoAcceptAndRelease('CT-1', MID, 'x'), false, s);
      assert.ok(!sql.some((q) => /^s*(UPDATE|INSERT)/.test(q)), s);
    }
  });

  it('rolls back everything when escrow can not cover the release', async () => {
    const { svc, sql } = setup([
      { rows: [contractRow({ ...gig, escrow_funded: '0.00' })] }, { rows: [milestoneRow({ status: 'submitted' })] },
      { rows: [{ id: MID }] }, { rows: [{ id: MID }] }, { rows: [] },
    ]);
    await assert.rejects(svc.autoAcceptAndRelease('CT-1', MID, 'x'), status(409));
    assert.ok(!sql.some((q) => /ledger_entries|audit_log/.test(q)));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });
});
