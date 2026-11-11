import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, RequestMethod, ServiceUnavailableException } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import type { NotificationsService } from '../notifications/notifications.service';
import type { InvoicesService } from '../invoices/invoices.service';
import type { EmailService } from '../email/email.service';
import type { PaymentsService } from '../payments/payments.service';
import { ContractsService } from '../contracts/contracts.service';
import { ProjectsController } from '../projects/projects.controller';
import { DisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';
import { DisputeSweepService, DISPUTE_SWEEP_LOCK_KEY } from './dispute-sweep.service';
import { isOverdue } from './dispute.mapper';

// ─── Fakes ──────────────────────────────────────────────────────────────────

type Rows = unknown[];
type Reply = Rows | Error | ((params: unknown[]) => Rows | Error);
type Route = [RegExp, Reply];

/**
 * A pool answering each query from the first route whose pattern matches its SQL (no
 * match: no rows). Records every statement, so tests can check what ran and in what order
 * relative to BEGIN / COMMIT.
 */
function fakeDb(routes: Route[]) {
  const log: { sql: string; params: unknown[] }[] = [];
  const query = async (text: string, values: unknown[] = []) => {
    log.push({ sql: text, params: values });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    for (const [re, reply] of routes) {
      if (!re.test(text)) continue;
      const out = typeof reply === 'function' ? reply(values) : reply;
      if (out instanceof Error) throw out;
      return { rows: out, rowCount: out.length };
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  const index = (re: RegExp) => log.findIndex((q) => re.test(q.sql));
  const find = (re: RegExp) => log.find((q) => re.test(q.sql));
  const all = (re: RegExp) => log.filter((q) => re.test(q.sql));
  return { pool, log, index, find, all };
}

function setup(routes: Route[]) {
  const db = fakeDb(routes);
  const sent: { userId: string; text: string; link: string }[] = [];
  const notifications = {
    send: async (userId: string, text: string, link: string) => { sent.push({ userId, text, link }); return {}; },
  } as unknown as NotificationsService;
  const queued: { template: string; to: string; data: Record<string, unknown>; dedupeKey?: string; inTx: boolean }[] = [];
  const email = {
    enqueue: async (template: string, to: string, data: Record<string, unknown>, opts: { dedupeKey?: string; client?: unknown } = {}) => {
      queued.push({ template, to, data, dedupeKey: opts.dedupeKey, inTx: opts.client !== undefined });
      return 'mail-1';
    },
  } as unknown as EmailService;
  const payments = {
    assertConfigured: () => undefined,
    registerPurpose: () => undefined,
    registerRefundHandler: () => undefined,
  } as unknown as PaymentsService;
  const contracts = new ContractsService(db.pool, notifications, payments, email, {} as InvoicesService);
  // The refund flow itself is covered by contracts.service.spec.ts; here we record the call
  // and where it happened relative to the resolution's COMMIT.
  const refundCalls: { contractId: string; amount?: number; reason: string; at: number }[] = [];
  let refundReply: () => Promise<unknown> = async () => ({ contractId: 'CT-1', refunds: [{ status: 'pending' }], refundDue: 0 });
  contracts.issueRefund = (async (contractId: string, dto: { amount?: number; reason: string }) => {
    refundCalls.push({ contractId, amount: dto.amount, reason: dto.reason, at: db.log.length });
    return refundReply();
  }) as ContractsService['issueRefund'];
  const svc = new DisputesService(db.pool, contracts, notifications, email);
  return {
    ...db, svc, contracts, sent, queued, refundCalls,
    setRefundReply: (fn: () => Promise<unknown>) => { refundReply = fn; },
  };
}

const status = (code: number) => (e: HttpException) => e.getStatus() === code;

const buyer = { id: 'buyer-1', role: 'Buyer', firstName: 'Bina', lastName: 'Buyer' } as User;
const expert = { id: 'exp-1', role: 'Freelancer', firstName: 'Eshan', lastName: 'Expert' } as User;
const admin = { id: 'adm-1', role: 'Admin', firstName: 'Ada', lastName: 'Admin' } as User;
const outsider = { id: 'other-1', role: 'Buyer' } as User;

const MID = '11111111-1111-4111-8111-111111111111';
const MID2 = '22222222-2222-4222-8222-222222222222';

const contractRow = (over: Record<string, unknown> = {}) => ({
  id: 'CT-1', project_id: 'PRJ-1', proposal_id: 'P-1', tenant_id: 'T-1', buyer_id: 'buyer-1', expert_id: 'exp-1',
  engagement_model: 'fixed', payment_terms: { totalAmount: 1000 }, currency: 'INR', total_amount: '1000.00',
  escrow_funded: '1000.00', released: '0.00', status: 'active', nda_required: false, nda_text: null,
  buyer_signed_at: null, expert_signed_at: null, buyer_signature: null, expert_signature: null,
  cancelled_by: null, cancel_reason: null, refund_due: '0.00', source: 'app', created_at: new Date(), updated_at: new Date(),
  ...over,
});
const milestoneRow = (over: Record<string, unknown> = {}) => ({
  id: MID, contract_id: 'CT-1', seq: 1, title: 'Design', amount: '400.00', due_date: null, status: 'funded',
  funded_at: null, submitted_at: null, accepted_at: null, released_at: null, revision_count: 0,
  submission_note: null, revision_note: null, ...over,
});
const disputeRow = (over: Record<string, unknown> = {}) => ({
  id: 'DSP-1', contract_id: 'CT-1', milestone_id: MID, project_id: 'PRJ-1', raised_by: 'buyer-1', against_user: 'exp-1',
  reason_code: 'quality', description: 'The design misses the agreed screens', amount_in_dispute: '400.00',
  status: 'open', respond_by: new Date(Date.now() + 3_600_000), resolution: null, split_expert_amount: null,
  split_buyer_amount: null, resolution_note: null, resolved_by: null, resolved_at: null,
  previous_contract_status: 'active', escalated_at: null, source: 'app', created_at: new Date(), updated_at: new Date(),
  buyer_id: 'buyer-1', expert_id: 'exp-1', currency: 'INR', project_title: 'Proj', milestone_title: 'Design',
  raised_by_name: 'Bina Buyer', against_user_name: 'Eshan Expert',
  ...over,
});

/** Routes shared by most tests; put test-specific routes first to override. */
const base = (o: {
  contract?: Record<string, unknown>; milestone?: Record<string, unknown>; dispute?: Record<string, unknown>;
  openDisputes?: Rows; held?: string; heldMilestones?: Rows; otherOpen?: number; openMilestones?: number;
  messages?: Rows;
} = {}): Route[] => [
  [/FROM contracts WHERE id = \$1 FOR UPDATE/, [contractRow(o.contract)]],
  [/FROM contract_milestones WHERE id = \$1 AND contract_id = \$2 FOR UPDATE/, [milestoneRow(o.milestone)]],
  [/SELECT id, milestone_id FROM disputes WHERE contract_id/, o.openDisputes ?? []],
  [/AS held FROM contract_milestones/, [{ held: o.held ?? '400.00' }]],
  [/SELECT id, amount, status FROM contract_milestones/, o.heldMilestones ?? [{ id: MID, amount: '400.00', status: 'funded' }]],
  [/SELECT id FROM user_accounts WHERE role = 'Admin'/, [{ id: 'adm-1' }, { id: 'adm-2' }]],
  [/SELECT email, first_name FROM user_accounts/, (p) => [{ email: `${p[0]}@example.com`, first_name: String(p[0]) }]],
  [/SELECT contract_id FROM disputes WHERE id/, [{ contract_id: (o.dispute?.contract_id as string | null | undefined) ?? 'CT-1' }]],
  [/FOR UPDATE OF d/, [disputeRow(o.dispute)]],
  [/FROM dispute_messages dm/, o.messages ?? []],
  [/FROM disputes d\s+LEFT JOIN contracts c/, [disputeRow(o.dispute)]],
  [/SELECT COUNT\(\*\) AS n FROM disputes/, [{ n: String(o.otherOpen ?? 0) }]],
  [/SELECT COUNT\(\*\) AS open FROM contract_milestones/, [{ open: String(o.openMilestones ?? 1) }]],
  [/RETURNING id/, [{ id: 'x' }]],
];

const createDto = (over: Record<string, unknown> = {}) => ({
  contractId: 'CT-1', milestoneId: MID, reasonCode: 'quality' as const,
  description: 'The design misses the agreed screens', amountInDispute: 400, ...over,
});

// ─── Raise ──────────────────────────────────────────────────────────────────

describe('DisputesService.create', () => {
  it('raises on a funded milestone, freezes the contract in the same transaction and tells the other side + admins', async () => {
    const t = setup(base());
    const out = await t.svc.create(createDto(), buyer);
    assert.equal(out.id, 'DSP-1');
    const begin = t.index(/^BEGIN$/);
    const commit = t.index(/^COMMIT$/);
    const freeze = t.index(/UPDATE contracts SET status = 'disputed'/);
    const insert = t.index(/INSERT INTO disputes/);
    assert.ok(begin < freeze && freeze < commit && begin < insert && insert < commit);
    const params = t.log[insert].params;
    assert.match(String(params[0]), /^DSP-/);
    assert.deepEqual(params.slice(1, 7), ['CT-1', MID, 'PRJ-1', 'buyer-1', 'exp-1', 'quality']);
    assert.equal(params[9], 72); // respond_by = NOW() + 72 hours
    assert.equal(params[10], 'active'); // previous contract status
    assert.match(t.log[freeze].sql, /WHERE id = \$1 AND status = 'active'/);
    assert.deepEqual(t.sent.map((s) => s.userId).sort(), ['adm-1', 'adm-2', 'exp-1']);
    assert.deepEqual(t.queued.map((q) => [q.template, q.to, q.inTx]), [['dispute-opened', 'exp-1@example.com', true]]);
  });

  it('raises on a gig contract with no project: the dispute row carries a NULL project', async () => {
    const t = setup(base({ contract: { project_id: null, proposal_id: null, source: 'gig', title: 'Security audit' } }));
    await t.svc.create(createDto(), buyer);
    const insert = t.index(/INSERT INTO disputes/);
    assert.deepEqual(t.log[insert].params.slice(1, 7), ['CT-1', MID, null, 'buyer-1', 'exp-1', 'quality']);
  });

  it('lists disputes with the gig title when there is no project', async () => {
    const t = setup(base());
    await t.svc.findOne('DSP-1', buyer);
    const q = t.log.find((l) => /FROM disputes d\s+LEFT JOIN contracts c/.test(l.sql))?.sql ?? '';
    assert.match(q, /COALESCE\(pj\.title, c\.title\) AS project_title/);
    assert.match(q, /LEFT JOIN projects pj/);
  });

  it('lets the expert raise one too (against the buyer)', async () => {
    const t = setup(base({ milestone: { status: 'submitted' } }));
    await t.svc.create(createDto(), expert);
    const insert = t.find(/INSERT INTO disputes/)!;
    assert.deepEqual(insert.params.slice(4, 6), ['exp-1', 'buyer-1']);
  });

  it('refuses anyone but the two parties (admins included)', async () => {
    for (const who of [outsider, admin]) {
      const t = setup(base());
      await assert.rejects(t.svc.create(createDto(), who), status(403));
      assert.equal(t.index(/INSERT INTO disputes/), -1);
      assert.ok(t.index(/^ROLLBACK$/) > -1);
    }
  });

  it('refuses a contract that is not running', async () => {
    for (const s of ['pending_signature', 'completed', 'cancelled']) {
      const t = setup(base({ contract: { status: s } }));
      await assert.rejects(t.svc.create(createDto(), buyer), status(409));
      assert.equal(t.index(/INSERT INTO disputes/), -1);
    }
  });

  it('only accepts milestones with escrow at stake', async () => {
    for (const s of ['funded', 'submitted', 'revision_requested', 'accepted']) {
      const t = setup(base({ milestone: { status: s } }));
      await t.svc.create(createDto(), buyer);
    }
    for (const s of ['pending', 'released', 'cancelled']) {
      const t = setup(base({ milestone: { status: s } }));
      await assert.rejects(t.svc.create(createDto(), buyer), status(409));
      assert.equal(t.index(/UPDATE contracts SET status = 'disputed'/), -1);
    }
  });

  it('caps amountInDispute at the milestone amount, or the escrow held on the contract', async () => {
    const a = setup(base());
    await assert.rejects(a.svc.create(createDto({ amountInDispute: 400.01 }), buyer), status(400));
    const b = setup(base({ held: '700.00' }));
    await b.svc.create(createDto({ milestoneId: undefined, amountInDispute: 700 }), buyer);
    assert.equal(b.find(/INSERT INTO disputes/)!.params[2], null);
    const c = setup(base({ held: '700.00' }));
    await assert.rejects(c.svc.create(createDto({ milestoneId: undefined, amountInDispute: 700.5 }), buyer), status(400));
  });

  it('allows one open dispute per milestone (and none beside a contract-wide one)', async () => {
    const a = setup(base({ openDisputes: [{ id: 'DSP-0', milestone_id: MID }] }));
    await assert.rejects(a.svc.create(createDto(), buyer), status(409));
    const b = setup(base({ openDisputes: [{ id: 'DSP-0', milestone_id: null }] }));
    await assert.rejects(b.svc.create(createDto(), buyer), status(409));
    const c = setup(base({ openDisputes: [{ id: 'DSP-0', milestone_id: MID2 }] }));
    await assert.rejects(c.svc.create(createDto({ milestoneId: undefined, amountInDispute: undefined }), buyer), status(409));
    // Another milestone of an already-disputed contract is fine; the contract stays frozen.
    const d = setup(base({ contract: { status: 'disputed' }, openDisputes: [{ id: 'DSP-0', milestone_id: MID2 }] }));
    await d.svc.create(createDto(), buyer);
    assert.equal(d.index(/UPDATE contracts SET status = 'disputed'/), -1);
    assert.equal(d.find(/INSERT INTO disputes/)!.params[10], 'disputed');
  });

  it('turns a race on the partial unique index into 409', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    const t = setup([[/INSERT INTO disputes/, dup], ...base()]);
    await assert.rejects(t.svc.create(createDto(), buyer), status(409));
    assert.equal(t.sent.length, 0);
  });
});

// ─── Contract frozen ────────────────────────────────────────────────────────

describe('a disputed contract is frozen', () => {
  const contractsOnly = () => {
    const db = fakeDb([
      [/FROM contracts WHERE id = \$1 FOR UPDATE/, [contractRow({ status: 'disputed' })]],
      [/FROM contract_milestones WHERE id = \$1/, [milestoneRow({ status: 'accepted' })]],
      [/SELECT COUNT\(\*\) AS moved/, [{ moved: '0' }]],
    ]);
    const payments = {
      assertConfigured: () => undefined, registerPurpose: () => undefined, registerRefundHandler: () => undefined,
    } as unknown as PaymentsService;
    const svc = new ContractsService(db.pool, { send: async () => ({}) } as unknown as NotificationsService, payments,
      { enqueue: async () => null } as unknown as EmailService, {} as InvoicesService);
    return { ...db, svc };
  };

  it('answers 409 to every milestone action, funding and a buyer cancel', async () => {
    const calls: [string, (svc: ContractsService) => Promise<unknown>][] = [
      ['submit', (s) => s.submitMilestone('CT-1', MID, 'done', expert)],
      ['request revision', (s) => s.requestRevision('CT-1', MID, 'redo', buyer)],
      ['accept', (s) => s.acceptMilestone('CT-1', MID, buyer)],
      ['release', (s) => s.releaseMilestone('CT-1', MID, buyer)],
      ['fund', (s) => s.fundMilestone('CT-1', MID, buyer)],
      ['buyer cancel', (s) => s.cancel('CT-1', 'Changed plans', buyer)],
    ];
    for (const [name, call] of calls) {
      const t = contractsOnly();
      await assert.rejects(call(t.svc), status(409), name);
      assert.equal(t.index(/^COMMIT$/), -1, `${name} must not commit`);
      assert.equal(t.index(/INSERT INTO ledger_entries/), -1);
    }
  });
});

// ─── Read & messages ────────────────────────────────────────────────────────

describe('DisputesService.findOne / addMessage', () => {
  const messages = [
    { id: 'm1', dispute_id: 'DSP-1', author_id: 'exp-1', author_name: 'Eshan Expert', author_role: 'Freelancer', body: 'Not true', evidence_links: ['https://x.example/a'], is_internal: false, created_at: new Date() },
  ];

  it('hides internal notes from the parties at the query level, and shows them to admins', async () => {
    const p = setup(base({ messages }));
    const out = await p.svc.findOne('DSP-1', buyer);
    assert.match(p.find(/FROM dispute_messages dm/)!.sql, /AND dm\.is_internal = FALSE/);
    assert.equal(out.messages[0].authorSide, 'expert');
    assert.equal(out.heldAmount, 400);
    const a = setup(base({ messages }));
    await a.svc.findOne('DSP-1', admin);
    assert.doesNotMatch(a.find(/FROM dispute_messages dm/)!.sql, /is_internal = FALSE/);
  });

  it('refuses outsiders', async () => {
    const t = setup(base());
    await assert.rejects(t.svc.findOne('DSP-1', outsider), status(403));
    await assert.rejects(t.svc.addMessage('DSP-1', { body: 'hi' }, outsider), status(403));
  });

  it('lists only the caller’s disputes; admins see the whole queue, filtered by status', async () => {
    const p = setup(base());
    await p.svc.findAll(buyer, undefined, { page: 1, pageSize: 20, offset: 0 });
    assert.match(p.log[0].sql, /d\.raised_by = \$1 OR d\.against_user = \$1/);
    const a = setup(base());
    await a.svc.findAll(admin, 'under_review', { page: 1, pageSize: 20, offset: 0 });
    assert.deepEqual(a.log[0].params, ['under_review', 20, 0]);
    assert.doesNotMatch(a.log[0].sql, /raised_by = \$1/);
  });

  it('only admins post internal notes, which notify nobody', async () => {
    const t = setup(base());
    await assert.rejects(t.svc.addMessage('DSP-1', { body: 'note', internal: true }, buyer), status(403));
    const a = setup(base({ dispute: { status: 'under_review' } }));
    await a.svc.addMessage('DSP-1', { body: 'Looks like scope creep', internal: true }, admin);
    const insert = a.find(/INSERT INTO dispute_messages/)!;
    assert.equal(insert.params[4], true);
    assert.equal(a.index(/UPDATE disputes SET status = \$2/), -1); // an internal note does not change the status
    assert.equal(a.sent.length, 0);
  });

  it("moves open → under_review on the respondent's first reply and tells admins", async () => {
    const t = setup(base());
    await t.svc.addMessage('DSP-1', { body: 'Here is my side', evidenceLinks: ['https://drive.example/f'] }, expert);
    const upd = t.find(/UPDATE disputes SET status = \$2/)!;
    assert.deepEqual(upd.params, ['DSP-1', 'under_review', 'open']);
    assert.deepEqual(t.find(/INSERT INTO dispute_messages/)!.params[3], ['https://drive.example/f']);
    assert.ok(t.sent.some((s) => s.userId === 'buyer-1'));
    assert.ok(t.sent.some((s) => s.userId === 'adm-1' && /ready for review/.test(s.text)));
  });

  it("does not move the status on the raiser's own follow-up", async () => {
    const t = setup(base());
    await t.svc.addMessage('DSP-1', { body: 'More detail' }, buyer);
    assert.equal(t.index(/UPDATE disputes SET status = \$2/), -1);
  });

  it('admin question → awaiting_response; the next party reply → under_review', async () => {
    const a = setup(base({ dispute: { status: 'under_review' } }));
    await a.svc.addMessage('DSP-1', { body: 'Please share the brief' }, admin);
    assert.deepEqual(a.find(/UPDATE disputes SET status = \$2/)!.params, ['DSP-1', 'awaiting_response', 'under_review']);
    assert.deepEqual(a.sent.map((s) => s.userId).sort(), ['buyer-1', 'exp-1']);
    const b = setup(base({ dispute: { status: 'awaiting_response' } }));
    await b.svc.addMessage('DSP-1', { body: 'Attached' }, buyer);
    assert.deepEqual(b.find(/UPDATE disputes SET status = \$2/)!.params, ['DSP-1', 'under_review', 'awaiting_response']);
  });

  it('refuses non-https evidence and closed disputes', async () => {
    const t = setup(base());
    await assert.rejects(t.svc.addMessage('DSP-1', { body: 'x', evidenceLinks: ['http://insecure.example/a'] }, buyer), status(400));
    await assert.rejects(t.svc.addMessage('DSP-1', { body: 'x', evidenceLinks: ['javascript:alert(1)'] }, buyer), status(400));
    const many = Array.from({ length: 11 }, (_, i) => `https://e.example/${i}`);
    await assert.rejects(t.svc.addMessage('DSP-1', { body: 'x', evidenceLinks: many }, buyer), status(400));
    const r = setup(base({ dispute: { status: 'resolved' } }));
    await assert.rejects(r.svc.addMessage('DSP-1', { body: 'x' }, buyer), status(409));
  });
});

// ─── Withdraw ───────────────────────────────────────────────────────────────

describe('DisputesService.withdraw', () => {
  it('restores the contract to active when no other dispute is open', async () => {
    const t = setup(base({ contract: { status: 'disputed' } }));
    await t.svc.withdraw('DSP-1', buyer);
    const lockC = t.index(/FROM contracts WHERE id = \$1 FOR UPDATE/);
    const lockD = t.index(/FOR UPDATE OF d/);
    assert.ok(lockC < lockD, 'contract is locked before the dispute');
    assert.ok(t.index(/SET status = 'withdrawn'/) > -1);
    const restore = t.index(/UPDATE contracts SET status = 'active'/);
    assert.ok(restore > -1 && restore < t.index(/^COMMIT$/));
    assert.ok(t.sent.some((s) => s.userId === 'exp-1' && /withdrawn/.test(s.text)));
  });

  it('keeps the contract frozen while another dispute is open', async () => {
    const t = setup(base({ contract: { status: 'disputed' }, otherOpen: 1 }));
    await t.svc.withdraw('DSP-1', buyer);
    assert.equal(t.index(/UPDATE contracts SET status = 'active'/), -1);
  });

  it('is only for the raiser, before resolution', async () => {
    const a = setup(base({ contract: { status: 'disputed' } }));
    await assert.rejects(a.svc.withdraw('DSP-1', expert), status(403));
    const b = setup(base({ contract: { status: 'disputed' }, dispute: { status: 'resolved' } }));
    await assert.rejects(b.svc.withdraw('DSP-1', buyer), status(409));
  });
});

// ─── Resolve ────────────────────────────────────────────────────────────────

describe('DisputesService.resolve', () => {
  const disputed = { contract: { status: 'disputed' } };

  it('release_to_expert: releases the milestone with the normal release bookkeeping, then reopens the contract', async () => {
    const t = setup(base(disputed));
    const out = await t.svc.resolve('DSP-1', { resolution: 'release_to_expert', note: 'Delivered as agreed' }, admin);
    const begin = t.index(/^BEGIN$/);
    const commit = t.index(/^COMMIT$/);
    const released = t.find(/SET released = released \+ \$2/)!;
    assert.deepEqual(released.params, ['CT-1', 400, 'disputed']);
    assert.match(released.sql, /released \+ \$2 <= escrow_funded/);
    const ledger = t.find(/INSERT INTO ledger_entries/)!;
    const [, , userId, type, desc, amount, unit, payee, by, ref] = ledger.params;
    assert.deepEqual([userId, type, amount, unit, payee, by, ref], ['exp-1', 'Escrow release', 400, 'INR', 'exp-1', 'adm-1', `CT-1/${MID}`]);
    assert.match(String(desc), /dispute DSP-1/);
    assert.ok(t.index(/UPDATE contract_milestones SET status = 'released'/) < commit);
    const resolved = t.find(/SET status = 'resolved'/)!;
    assert.deepEqual(resolved.params.slice(0, 4), ['DSP-1', 'release_to_expert', null, null]);
    const audit = t.find(/INSERT INTO audit_log/)!;
    assert.equal(audit.params[3], 'dispute:DSP-1');
    assert.deepEqual(JSON.parse(String(audit.params[4])).toExpert, 400);
    const restore = t.index(/UPDATE contracts SET status = 'active'/);
    assert.ok(begin < restore && restore < commit);
    assert.equal(t.index(/refund_due = refund_due \+/), -1);
    assert.equal(t.refundCalls.length, 0);
    assert.deepEqual(out.refund, { amount: 0, status: 'none' });
    assert.deepEqual(t.queued.map((q) => q.template), ['dispute-resolved', 'dispute-resolved']);
    assert.deepEqual(t.sent.map((s) => s.userId).sort(), ['buyer-1', 'exp-1']);
  });

  it('completes the contract when every milestone is settled', async () => {
    const t = setup(base({ ...disputed, openMilestones: 0 }));
    await t.svc.resolve('DSP-1', { resolution: 'release_to_expert', note: 'Delivered' }, admin);
    const done = t.find(/WITH done AS/)!;
    assert.deepEqual(done.params, ['CT-1', 'disputed']);
    assert.equal(t.index(/UPDATE contracts SET status = 'active'/), -1);
  });

  it('refund_to_buyer: cancels the milestone, adds its held amount to refund_due, and refunds after COMMIT', async () => {
    const t = setup(base(disputed));
    const out = await t.svc.resolve('DSP-1', { resolution: 'refund_to_buyer', note: 'Not delivered' }, admin);
    assert.deepEqual(t.find(/refund_due = refund_due \+ \$2/)!.params, ['CT-1', 400]);
    assert.ok(t.index(/UPDATE contract_milestones SET status = 'cancelled'/) > -1);
    assert.equal(t.index(/INSERT INTO ledger_entries/), -1);
    assert.equal(t.refundCalls.length, 1);
    assert.equal(t.refundCalls[0].amount, 400);
    assert.match(t.refundCalls[0].reason, /^Dispute DSP-1: Not delivered/);
    assert.ok(t.refundCalls[0].at > t.index(/^COMMIT$/), 'refund starts after COMMIT');
    assert.deepEqual(out.refund, { amount: 400, status: 'requested' });
  });

  it('a refund that cannot start does not undo the resolution', async () => {
    const t = setup(base(disputed));
    t.setRefundReply(async () => { throw new ServiceUnavailableException('Payments are not configured'); });
    const out = await t.svc.resolve('DSP-1', { resolution: 'refund_to_buyer', note: 'Not delivered' }, admin);
    assert.equal(out.refund.status, 'failed');
    assert.match(out.refund.error ?? '', /not configured/);
    assert.ok(t.index(/^COMMIT$/) > -1);
    assert.equal(t.index(/^ROLLBACK$/), -1);
  });

  it('split: releases the expert share, owes the buyer share, and both must add up to the held amount', async () => {
    const t = setup(base(disputed));
    const out = await t.svc.resolve('DSP-1', { resolution: 'split', note: 'Half done', splitExpertAmount: 250, splitBuyerAmount: 150 }, admin);
    assert.deepEqual(t.find(/SET released = released \+ \$2/)!.params, ['CT-1', 250, 'disputed']);
    assert.equal(t.find(/INSERT INTO ledger_entries/)!.params[5], 250);
    assert.deepEqual(t.find(/refund_due = refund_due \+ \$2/)!.params, ['CT-1', 150]);
    assert.ok(t.index(/UPDATE contract_milestones SET status = 'released'/) > -1);
    assert.deepEqual(t.find(/SET status = 'resolved'/)!.params.slice(1, 4), ['split', 2.5e2, 1.5e2]);
    assert.equal(t.refundCalls[0].amount, 150);
    assert.equal(out.refund.status, 'requested');

    const bad = setup(base(disputed));
    await assert.rejects(
      bad.svc.resolve('DSP-1', { resolution: 'split', note: 'x y z', splitExpertAmount: 250, splitBuyerAmount: 100 }, admin), status(400));
    assert.equal(bad.index(/^COMMIT$/), -1);
    assert.equal(bad.refundCalls.length, 0);
    const missing = setup(base(disputed));
    await assert.rejects(missing.svc.resolve('DSP-1', { resolution: 'split', note: 'x y z', splitExpertAmount: 400 }, admin), status(400));
    const extra = setup(base(disputed));
    await assert.rejects(
      extra.svc.resolve('DSP-1', { resolution: 'release_to_expert', note: 'x y z', splitExpertAmount: 400 }, admin), status(400));
  });

  it('a contract-wide split pays the expert milestone by milestone', async () => {
    const t = setup([
      [/FROM contract_milestones WHERE id = \$1 AND contract_id = \$2 FOR UPDATE/, (p) => [p[0] === MID
        ? milestoneRow()
        : milestoneRow({ id: MID2, seq: 2, title: 'Build', amount: '600.00', status: 'accepted' })]],
      ...base({
        ...disputed, dispute: { milestone_id: null },
        heldMilestones: [{ id: MID, amount: '400.00', status: 'funded' }, { id: MID2, amount: '600.00', status: 'accepted' }],
      }),
    ]);
    await t.svc.resolve('DSP-1', { resolution: 'split', note: 'Partly done', splitExpertAmount: 700, splitBuyerAmount: 300 }, admin);
    assert.deepEqual(t.all(/SET released = released \+ \$2/).map((q) => q.params[1]), [400, 300]);
    assert.deepEqual(t.all(/refund_due = refund_due \+ \$2/).map((q) => q.params[1]), [300]);
    assert.equal(t.refundCalls[0].amount, 300);
  });

  it('no_action moves no money but still unfreezes the contract', async () => {
    const t = setup(base(disputed));
    const out = await t.svc.resolve('DSP-1', { resolution: 'no_action', note: 'Both sides agreed to continue' }, admin);
    assert.equal(t.index(/SET released = released/), -1);
    assert.equal(t.index(/refund_due = refund_due/), -1);
    assert.equal(t.index(/UPDATE contract_milestones/), -1);
    assert.ok(t.index(/UPDATE contracts SET status = 'active'/) > -1);
    assert.equal(out.refund.status, 'none');
  });

  it('leaves the contract disputed while another dispute is open', async () => {
    const t = setup(base({ ...disputed, otherOpen: 1 }));
    await t.svc.resolve('DSP-1', { resolution: 'release_to_expert', note: 'Delivered' }, admin);
    assert.equal(t.index(/UPDATE contracts SET status = 'active'/), -1);
    assert.equal(t.index(/WITH done AS/), -1);
  });

  it('refuses non-admins, closed disputes, and money moves on a contract that is no longer disputed', async () => {
    const a = setup(base(disputed));
    await assert.rejects(a.svc.resolve('DSP-1', { resolution: 'no_action', note: 'x y z' }, buyer), status(403));
    const b = setup(base({ ...disputed, dispute: { status: 'withdrawn' } }));
    await assert.rejects(b.svc.resolve('DSP-1', { resolution: 'no_action', note: 'x y z' }, admin), status(409));
    const c = setup(base({ contract: { status: 'cancelled' } }));
    await assert.rejects(c.svc.resolve('DSP-1', { resolution: 'refund_to_buyer', note: 'x y z' }, admin), status(409));
    const d = setup(base({ ...disputed, heldMilestones: [] }));
    await assert.rejects(d.svc.resolve('DSP-1', { resolution: 'release_to_expert', note: 'x y z' }, admin), status(409));
  });
});

// ─── SLA sweep ──────────────────────────────────────────────────────────────

describe('DisputeSweepService', () => {
  /** Two "instances" sharing one advisory lock, as two API processes share Postgres. */
  function sharedLockDb(opts: { moved: Rows; holdUpdate?: Promise<void> }) {
    let holder: number | null = null;
    let nextClient = 0;
    const log: { client: number; sql: string; params: unknown[] }[] = [];
    let released = 0;
    const pool = {
      connect: async () => {
        const me = ++nextClient;
        return {
          release: () => { released += 1; },
          query: async (sql: string, params: unknown[] = []) => {
            log.push({ client: me, sql, params });
            if (/pg_try_advisory_lock/.test(sql)) {
              const ok = holder === null;
              if (ok) holder = me;
              return { rows: [{ locked: ok }] };
            }
            if (/pg_advisory_unlock/.test(sql)) {
              if (holder === me) holder = null;
              return { rows: [{ pg_advisory_unlock: true }] };
            }
            if (/UPDATE disputes d/.test(sql)) {
              await opts.holdUpdate;
              return { rows: opts.moved };
            }
            if (/role = 'Admin'/.test(sql)) return { rows: [{ id: 'adm-1' }] };
            return { rows: [] };
          },
        };
      },
    } as unknown as Pool;
    return { pool, log, released: () => released, holder: () => holder };
  }

  const config = (enabled?: string) => ({ get: (k: string) => (k === 'DISPUTE_SWEEP_ENABLED' ? enabled : undefined) }) as never;
  const notifier = () => {
    const sent: { userId: string; text: string }[] = [];
    return { sent, svc: { send: async (userId: string, text: string) => { sent.push({ userId, text }); return {}; } } as unknown as NotificationsService };
  };

  it('moves unanswered open disputes past respond_by to review and notifies admins', async () => {
    const db = sharedLockDb({ moved: [{ id: 'DSP-1', contract_id: 'CT-1' }] });
    const n = notifier();
    const sweep = new DisputeSweepService(db.pool, n.svc, config());
    assert.equal(await sweep.sweep(), 1);
    const update = db.log.find((q) => /UPDATE disputes d/.test(q.sql))!;
    assert.match(update.sql, /d\.status = 'open' AND d\.respond_by < NOW\(\)/);
    assert.match(update.sql, /NOT EXISTS[\s\S]*dm\.author_id = d\.against_user/);
    assert.match(update.sql, /SET status = 'under_review', escalated_at = NOW\(\)/);
    assert.equal(db.log[0].params[0], DISPUTE_SWEEP_LOCK_KEY);
    assert.ok(db.log.some((q) => /pg_advisory_unlock/.test(q.sql)), 'the lock is released');
    assert.equal(db.holder(), null);
    assert.equal(db.released(), 1);
    assert.deepEqual(n.sent.map((s) => s.userId), ['adm-1']);
  });

  it('a second instance skips the round while the first holds the advisory lock', async () => {
    let finish!: () => void;
    const holdUpdate = new Promise<void>((resolve) => { finish = resolve; });
    const db = sharedLockDb({ moved: [{ id: 'DSP-1', contract_id: 'CT-1' }], holdUpdate });
    const a = new DisputeSweepService(db.pool, notifier().svc, config());
    const b = new DisputeSweepService(db.pool, notifier().svc, config());
    const first = a.sweep();
    await new Promise((r) => setImmediate(r)); // let A take the lock and start its UPDATE
    assert.equal(await b.sweep(), null);
    finish();
    assert.equal(await first, 1);
    const updates = db.log.filter((q) => /UPDATE disputes d/.test(q.sql));
    assert.equal(updates.length, 1, 'only one instance swept');
    assert.equal(updates[0].client, 1);
    assert.equal(db.released(), 2, 'both instances returned their connection');
  });

  it('does not schedule anything when DISPUTE_SWEEP_ENABLED=false', async () => {
    const db = sharedLockDb({ moved: [] });
    const sweep = new DisputeSweepService(db.pool, notifier().svc, config('false'));
    sweep.onApplicationBootstrap();
    await sweep.onApplicationShutdown();
    assert.equal(db.log.length, 0);
  });

  it('flags open disputes past their deadline as overdue', () => {
    assert.equal(isOverdue({ status: 'open', respond_by: new Date(Date.now() - 1000) }), true);
    assert.equal(isOverdue({ status: 'open', respond_by: new Date(Date.now() + 60_000) }), false);
    assert.equal(isOverdue({ status: 'under_review', respond_by: new Date(Date.now() - 1000) }), false);
  });
});

// ─── Routes ─────────────────────────────────────────────────────────────────

describe('routes', () => {
  const routesOf = (ctrl: { prototype: object }) => Object.getOwnPropertyNames(ctrl.prototype)
    .filter((name) => name !== 'constructor')
    .map((name) => {
      const handler = (ctrl.prototype as Record<string, unknown>)[name] as object;
      return { name, path: Reflect.getMetadata(PATH_METADATA, handler) as string | undefined, method: Reflect.getMetadata(METHOD_METADATA, handler) as RequestMethod | undefined };
    })
    .filter((r) => r.path !== undefined);

  it('the old /projects/disputes routes are gone', () => {
    const paths = routesOf(ProjectsController).map((r) => r.path);
    assert.ok(!paths.some((p) => /disputes/.test(String(p))), `found ${paths.join(', ')}`);
    for (const m of ['findDisputes', 'createDispute', 'resolveDispute']) {
      assert.equal((ProjectsController.prototype as unknown as Record<string, unknown>)[m], undefined);
    }
  });

  it('/disputes exposes list, detail, raise, messages, withdraw and resolve', () => {
    assert.equal(Reflect.getMetadata(PATH_METADATA, DisputesController), 'disputes');
    const routes = routesOf(DisputesController).map((r) => `${RequestMethod[r.method!]} ${r.path}`).sort();
    assert.deepEqual(routes, [
      'GET /', 'GET :id', 'POST /', 'POST :id/messages', 'POST :id/resolve', 'POST :id/withdraw',
    ]);
  });
});
