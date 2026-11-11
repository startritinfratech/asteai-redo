import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import type { Pool, PoolClient } from 'pg';
import type { User } from '@asteai/types';
import type { EmailService } from '../email/email.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { InvoicesController } from './invoices.controller';
import { invoiceNumber, InvoicesService } from './invoices.service';
import { pdfMoney, renderInvoicePdf } from './invoice-pdf';
import { mapInvoice } from './invoice.mapper';

type Reply = { rows: unknown[] } | { error: unknown };

function fakePool(replies: Reply[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
    const next = replies.shift() ?? { rows: [] };
    if ('error' in next) throw next.error;
    return { rowCount: next.rows.length, ...next };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

function setup(replies: Reply[]) {
  const db = fakePool(replies);
  const sent: { userId: string; text: string; client?: unknown }[] = [];
  const emails: { template: string; to: string; opts: Record<string, unknown> }[] = [];
  const notifications = {
    send: async (userId: string, text: string, _link: string, client?: unknown) => { sent.push({ userId, text, client }); return {}; },
  } as unknown as NotificationsService;
  const email = {
    enqueue: async (template: string, to: string, _d: unknown, opts: Record<string, unknown>) => { emails.push({ template, to, opts }); return 'e'; },
  } as unknown as EmailService;
  const config = { get: () => undefined } as unknown as ConfigService;
  return { ...db, sent, emails, svc: new InvoicesService(db.pool, config, notifications, email) };
}

const status = (code: number) => (e: HttpException) => e.getStatus() === code;

const buyer = { id: 'buyer-1', role: 'Buyer' } as User;
const expert = { id: 'exp-1', role: 'Freelancer' } as User;
const admin = { id: 'adm-1', role: 'Admin' } as User;
const outsider = { id: 'other-1', role: 'Buyer' } as User;

const PAY = '33333333-3333-4333-8333-333333333333';
const paymentRow = (over: Record<string, unknown> = {}) => ({
  id: PAY, status: 'captured', amount: '400.00', currency: 'INR', provider: 'razorpay', provider_payment_id: 'pay_1',
  contract_id: 'CT-1', milestone_id: 'm-1', buyer_id: 'buyer-1', expert_id: 'exp-1', milestone_seq: 1,
  milestone_title: 'Design', project_title: 'Proj', buyer_name: 'Bina Buyer', buyer_first_name: 'Bina',
  buyer_email: 'b@x.com', expert_name: 'Eshan Expert', issue_year: 2026, ...over,
});
const invoiceRow = (over: Record<string, unknown> = {}) => ({
  id: 'INV-2026-000007', contract_id: 'CT-1', milestone_id: 'm-1', escrow_payment_id: PAY, buyer_id: 'buyer-1',
  expert_id: 'exp-1', amount: '400.00', platform_fee: '0.00', currency: 'INR', gstin: null, tax_amount: null,
  provider: 'razorpay', provider_payment_id: 'pay_1', buyer_name: 'Bina Buyer', buyer_email: 'b@x.com',
  expert_name: 'Eshan Expert', project_title: 'Proj', milestone_seq: 1, milestone_title: 'Design',
  issued_at: new Date('2026-11-11T10:00:00Z'), ...over,
});

describe('invoice numbers', () => {
  it('are INV-<year>-<6 digits>', () => {
    assert.equal(invoiceNumber(2026, 123), 'INV-2026-000123');
    assert.equal(invoiceNumber(2027, 1234567), 'INV-2027-1234567');
  });
});

describe('InvoicesService.createForCapturedPayment', () => {
  it('issues a numbered invoice for a captured payment and tells the buyer in the same transaction', async () => {
    const { svc, sql, params, sent, emails } = setup([
      { rows: [paymentRow()] }, { rows: [] }, { rows: [{ last: 7 }] }, { rows: [invoiceRow()] },
    ]);
    const out = await svc.createForCapturedPayment(PAY);
    assert.equal(out.id, 'INV-2026-000007');
    assert.equal(out.total, 400);
    assert.match(sql[1], /FOR UPDATE OF ep/);
    const ins = sql.findIndex((q) => /INSERT INTO invoices/.test(q));
    assert.equal(params[ins][0], 'INV-2026-000007');
    assert.deepEqual(params[sql.findIndex((q) => /invoice_counters/.test(q))], [2026]);
    assert.deepEqual(sent.map((s) => s.userId), ['buyer-1']);
    assert.ok(sent[0].client, 'notification written with the transaction client');
    assert.equal(emails[0].template, 'invoice-issued');
    assert.equal(emails[0].opts.dedupeKey, 'invoice-issued:INV-2026-000007');
    assert.ok(sql.indexOf('COMMIT') > ins);
  });

  it('invoices a gig payment (a contract with no project): LEFT JOIN, titled with the gig title', async () => {
    const { svc, sql, params } = setup([
      { rows: [paymentRow({ project_title: 'Security audit' })] }, { rows: [] }, { rows: [{ last: 8 }] },
      { rows: [invoiceRow({ project_title: 'Security audit' })] },
    ]);
    const out = await svc.createForCapturedPayment(PAY);
    assert.match(sql[1], /LEFT JOIN projects pj ON pj\.id = c\.project_id/);
    assert.match(sql[1], /COALESCE\(pj\.title, c\.title\) AS project_title/);
    assert.equal(out.projectTitle, 'Security audit');
    assert.ok(params[sql.findIndex((q) => /INSERT INTO invoices/.test(q))].includes('Security audit'));
  });

  it('is idempotent: a second call returns the existing invoice without a new number or messages', async () => {
    const { svc, sql, sent, emails } = setup([{ rows: [paymentRow()] }, { rows: [invoiceRow()] }]);
    const out = await svc.createForCapturedPayment(PAY);
    assert.equal(out.id, 'INV-2026-000007');
    assert.ok(!sql.some((q) => /invoice_counters|INSERT INTO invoices/.test(q)));
    assert.equal(sent.length + emails.length, 0);
  });

  it('refuses a payment that is not captured, and an unknown payment', async () => {
    const pending = setup([{ rows: [paymentRow({ status: 'pending' })] }, { rows: [] }]);
    await assert.rejects(pending.svc.createForCapturedPayment(PAY), status(409));
    assert.equal(pending.sql.at(-1), 'ROLLBACK');
    const missing = setup([{ rows: [] }]);
    await assert.rejects(missing.svc.createForCapturedPayment(PAY), status(404));
  });

  it('runs inside the caller\'s transaction when given its client', async () => {
    const { svc, sql, pool } = setup([{ rows: [paymentRow()] }, { rows: [] }, { rows: [{ last: 1 }] }, { rows: [invoiceRow()] }]);
    const client = await pool.connect() as unknown as PoolClient;
    await svc.createForCapturedPayment(PAY, client);
    assert.ok(!sql.includes('BEGIN') && !sql.includes('COMMIT'));
  });
});

describe('InvoicesService access', () => {
  it('lists only the caller\'s invoices; admins see all', async () => {
    const mine = setup([{ rows: [invoiceRow()] }]);
    await mine.svc.list(expert, { page: 1, pageSize: 50, offset: 0 });
    assert.match(mine.sql[0], /buyer_id = \$3 OR expert_id = \$3/);
    assert.equal(mine.params[0][2], 'exp-1');
    const all = setup([{ rows: [] }]);
    await all.svc.list(admin, { page: 1, pageSize: 50, offset: 0 });
    assert.doesNotMatch(all.sql[0], /buyer_id/);
  });

  it('shows an invoice to its buyer, its expert and admins only', async () => {
    for (const u of [buyer, expert, admin]) {
      const { svc } = setup([{ rows: [invoiceRow()] }]);
      assert.equal((await svc.findOne(u, 'INV-2026-000007')).id, 'INV-2026-000007', u.id);
    }
    const other = setup([{ rows: [invoiceRow()] }]);
    await assert.rejects(other.svc.findOne(outsider, 'INV-2026-000007'), status(404));
    const missing = setup([{ rows: [] }]);
    await assert.rejects(missing.svc.findOne(admin, 'INV-2026-999999'), status(404));
  });
});

describe('GET /invoices/:id/pdf', () => {
  function fakeRes() {
    const out: { headers: Record<string, string>; body?: Buffer } = { headers: {} };
    const res = {
      set: (h: Record<string, string>) => { Object.assign(out.headers, h); return res; },
      send: (b: Buffer) => { out.body = b; return res; },
    } as unknown as Response;
    return { res, out };
  }

  it('streams a PDF to a party', async () => {
    const { svc } = setup([{ rows: [invoiceRow()] }]);
    const { res, out } = fakeRes();
    await new InvoicesController(svc).pdf(buyer, 'INV-2026-000007', res);
    assert.equal(out.headers['Content-Type'], 'application/pdf');
    assert.match(out.headers['Content-Disposition'], /INV-2026-000007\.pdf/);
    assert.equal(out.body?.subarray(0, 5).toString(), '%PDF-');
    assert.equal(out.headers['Content-Length'], String(out.body?.length));
  });

  it('refuses anyone else before rendering', async () => {
    const { svc } = setup([{ rows: [invoiceRow()] }]);
    const { res, out } = fakeRes();
    await assert.rejects(new InvoicesController(svc).pdf(outsider, 'INV-2026-000007', res), status(404));
    assert.equal(out.body, undefined);
  });
});

describe('invoice PDF', () => {
  it('formats money without a rupee glyph the standard fonts lack', () => {
    assert.equal(pdfMoney(123456.5, 'INR'), 'INR 1,23,456.50');
  });

  it('renders with tax and non-Latin names', async () => {
    const pdf = await renderInvoicePdf(
      mapInvoice(invoiceRow({ tax_amount: '72.00', gstin: '29ABCDE1234F1Z5', buyer_name: 'बीना' })),
      { name: 'AsteAI', address: 'Chennai', gstin: '33ABCDE1234F1Z5' },
    );
    assert.equal(pdf.subarray(0, 5).toString(), '%PDF-');
  });
});
