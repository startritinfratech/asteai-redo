import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ConflictException, HttpException } from '@nestjs/common';
import type { NotificationsService } from '../notifications/notifications.service';
import type { Pool } from 'pg';
import {
  PaymentProviderError, RazorpayProvider, type CreateOrderInput, type PaymentProvider, type ProviderOrder,
} from './payment-provider';
import {
  PaymentsService, redactPayload, type OpenOrderInput, type PaymentOrderRow, type PaymentsConfig, type RefundEvent,
} from './payments.service';
import { hmacSha256Hex, safeEqualHex, verifyCheckoutSignature, verifyWebhookSignature } from './signatures';

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
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

const KEY_SECRET = 'test_key_secret_123';
const WEBHOOK_SECRET = 'test_webhook_secret_456';
const CONFIG: PaymentsConfig = { keyId: 'rzp_test_key', keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET };

function fakeProvider(opts: { fail?: Error } = {}) {
  const created: CreateOrderInput[] = [];
  const provider: PaymentProvider = {
    createOrder: async (input): Promise<ProviderOrder> => {
      created.push(input);
      if (opts.fail) throw opts.fail;
      return { id: `order_${created.length}`, amountMinor: input.amountMinor, currency: input.currency, status: 'created' };
    },
    refund: async (input) => ({ id: 'rfnd_1', amountMinor: input.amountMinor, status: 'pending' }),
  };
  return { provider, created };
}

function setup(replies: Reply[], opts: { config?: PaymentsConfig; provider?: PaymentProvider | null; providerFail?: Error } = {}) {
  const db = fakePool(replies);
  const fake = fakeProvider({ fail: opts.providerFail });
  const provider = opts.provider === undefined ? fake.provider : opts.provider;
  const notified: { userId: string; text: string; link?: string }[] = [];
  const notifications = {
    send: async (userId: string, text: string, link?: string) => { notified.push({ userId, text, link }); },
  } as unknown as NotificationsService;
  const refunded: { paymentId: string; amountMinor: number }[] = [];
  const base = provider;
  const tracked: PaymentProvider | null = base && {
    createOrder: (i) => base.createOrder(i),
    refund: async (i) => { refunded.push({ paymentId: i.paymentId, amountMinor: i.amountMinor }); return base.refund(i); },
  };
  const svc = new PaymentsService(db.pool, opts.config ?? CONFIG, tracked, notifications);
  const paid: { order: PaymentOrderRow; providerPaymentId: string; actor: string }[] = [];
  const refundEvents: RefundEvent[] = [];
  svc.registerPurpose('escrow_milestone', {
    onPaid: async (order, providerPaymentId, actor) => {
      paid.push({ order, providerPaymentId, actor });
      return { alreadyCaptured: false };
    },
  });
  svc.registerRefundHandler(async (e) => { refundEvents.push(e); });
  return { ...db, svc, created: fake.created, paid, refundEvents, notified, refunded };
}

const status = (code: number) => (e: HttpException) => e.getStatus() === code;

const order = (over: Partial<PaymentOrderRow> = {}): PaymentOrderRow => ({
  id: 'po-1', purpose: 'escrow_milestone', escrow_payment_id: 'pay-1', user_id: 'buyer-1', amount_minor: '40000',
  currency: 'INR', provider: 'razorpay', provider_order_id: 'order_ABC', status: 'created', receipt: 'pay-1',
  provider_payment_id: null, ...over,
});

const openInput: OpenOrderInput = {
  purpose: 'escrow_milestone', escrowPaymentId: 'pay-1', userId: 'buyer-1', amountMinor: 40000, currency: 'INR',
  receipt: 'pay-1', notes: { contractId: 'CT-1', milestoneId: 'm-1', escrowPaymentId: 'pay-1' },
};

const sign = (orderId: string, paymentId: string) => hmacSha256Hex(KEY_SECRET, `${orderId}|${paymentId}`);

function webhook(event: string, payload: unknown, created_at = 1700000000) {
  const raw = Buffer.from(JSON.stringify({ entity: 'event', event, payload, created_at }));
  return { raw, sig: hmacSha256Hex(WEBHOOK_SECRET, raw) };
}
const capturedPayment = (over: Record<string, unknown> = {}) => ({
  payment: {
    entity: {
      id: 'pay_RZP', order_id: 'order_ABC', amount: 40000, currency: 'INR', status: 'captured',
      email: 'bina@example.com', contact: '+919999999999', card: { last4: '1111', name: 'Bina' }, ...over,
    },
  },
});

// ─── Signatures ─────────────────────────────────────────────────────────────

describe('signatures', () => {
  it('accepts a valid checkout signature', () => {
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', sign('order_1', 'pay_1'), KEY_SECRET), true);
  });

  it('rejects a tampered signature, a swapped id and the wrong secret', () => {
    const good = sign('order_1', 'pay_1');
    const tampered = `${good.slice(0, -1)}${good.endsWith('0') ? '1' : '0'}`;
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', tampered, KEY_SECRET), false);
    assert.equal(verifyCheckoutSignature('order_1', 'pay_2', good, KEY_SECRET), false);
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', good, 'other_secret'), false);
  });

  it('rejects wrong-length and non-string signatures without throwing (timing-safe compare)', () => {
    const good = sign('order_1', 'pay_1');
    for (const bad of ['', good.slice(0, 63), `${good}0`, `${good}${good}`, 'zz', undefined, null, 42, {}]) {
      assert.equal(verifyCheckoutSignature('order_1', 'pay_1', bad, KEY_SECRET), false, String(bad));
    }
    assert.equal(safeEqualHex(good, good.toUpperCase()), true);
    assert.equal(verifyCheckoutSignature('order_1', 'pay_1', good, ''), false, 'an empty secret never verifies');
  });

  it('verifies webhooks over the exact raw bytes', () => {
    const raw = Buffer.from('{"event":"payment.captured"}');
    const sig = hmacSha256Hex(WEBHOOK_SECRET, raw);
    assert.equal(verifyWebhookSignature(raw, sig, WEBHOOK_SECRET), true);
    assert.equal(verifyWebhookSignature(Buffer.from('{"event": "payment.captured"}'), sig, WEBHOOK_SECRET), false);
    assert.equal(verifyWebhookSignature(raw, sig.slice(2), WEBHOOK_SECRET), false);
    assert.equal(verifyWebhookSignature(Buffer.alloc(0), hmacSha256Hex(WEBHOOK_SECRET, ''), WEBHOOK_SECRET), false);
  });
});

// ─── Orders ─────────────────────────────────────────────────────────────────

describe('PaymentsService.openOrder', () => {
  it('creates a Razorpay order and stores it', async () => {
    const { svc, sql, params, created } = setup([{ rows: [] }, { rows: [order({ provider_order_id: 'order_1' })] }]);
    const out = await svc.openOrder(openInput);
    assert.deepEqual(out, { orderId: 'order_1', amountMinor: 40000, currency: 'INR', keyId: 'rzp_test_key', reused: false });
    assert.deepEqual(created, [{ amountMinor: 40000, currency: 'INR', receipt: 'pay-1', notes: openInput.notes }]);
    const insert = sql.findIndex((q) => /INSERT INTO payment_orders/.test(q));
    assert.match(sql[insert], /ON CONFLICT \(escrow_payment_id\) WHERE status IN \('created', 'attempted'\) DO NOTHING/);
    assert.deepEqual(params[insert].slice(0, 6), ['escrow_milestone', 'pay-1', 'buyer-1', 40000, 'INR', 'order_1']);
  });

  it('reuses the open order on a repeat call without calling Razorpay', async () => {
    const { svc, sql, created } = setup([{ rows: [order()] }]);
    const out = await svc.openOrder(openInput);
    assert.equal(out.orderId, 'order_ABC');
    assert.equal(out.reused, true);
    assert.equal(created.length, 0);
    assert.equal(sql.length, 1);
  });

  it('hands out the winning order when a concurrent call stored one first', async () => {
    const { svc } = setup([{ rows: [] }, { rows: [] }, { rows: [order({ provider_order_id: 'order_WINNER' })] }]);
    const out = await svc.openOrder(openInput);
    assert.equal(out.orderId, 'order_WINNER');
    assert.equal(out.reused, true);
  });

  it('a provider failure stores nothing and answers 502 (the caller can retry)', async () => {
    const { svc, sql } = setup([{ rows: [] }], { providerFail: new PaymentProviderError('Razorpay timed out', 'unavailable') });
    await assert.rejects(svc.openOrder(openInput), status(502));
    assert.ok(!sql.some((q) => /INSERT/.test(q)));
  });

  it('retires an open order whose amount no longer matches', async () => {
    const { svc, sql, created } = setup([{ rows: [order({ amount_minor: '30000' })] }, { rows: [] }, { rows: [order({ provider_order_id: 'order_1' })] }]);
    await svc.openOrder(openInput);
    assert.ok(sql.some((q) => /SET status = 'expired'/.test(q)));
    assert.equal(created.length, 1);
  });

  it('answers 503 when Razorpay is not configured, before any query', async () => {
    for (const opts of [{ provider: null }, { config: { webhookSecret: WEBHOOK_SECRET } }]) {
      const { svc, sql } = setup([], opts);
      await assert.rejects(svc.openOrder(openInput), (e: HttpException) => e.getStatus() === 503 && /not configured/.test(e.message));
      assert.equal(sql.length, 0);
      assert.throws(() => svc.assertConfigured(), status(503));
    }
  });
});

// ─── Checkout verify ────────────────────────────────────────────────────────

describe('PaymentsService.verifyCheckout', () => {
  const input = { orderId: 'order_ABC', paymentId: 'pay_RZP', signature: sign('order_ABC', 'pay_RZP') };

  it('verifies, marks the order paid and captures through the purpose handler', async () => {
    const { svc, sql, params, paid } = setup([{ rows: [order()] }, { rows: [] }]);
    const out = await svc.verifyCheckout(input, { id: 'buyer-1' });
    assert.deepEqual(out, { status: 'captured', alreadyCaptured: false });
    const mark = sql.findIndex((q) => /UPDATE payment_orders\s+SET status = 'paid'/.test(q));
    assert.deepEqual(params[mark], ['po-1', 'pay_RZP']);
    assert.deepEqual(paid.map((p) => [p.order.escrow_payment_id, p.providerPaymentId, p.actor]), [['pay-1', 'pay_RZP', 'razorpay:verify']]);
  });

  it('rejects a bad signature before touching the database', async () => {
    const { svc, sql, paid } = setup([]);
    await assert.rejects(svc.verifyCheckout({ ...input, signature: sign('order_ABC', 'pay_OTHER') }, { id: 'buyer-1' }), status(400));
    await assert.rejects(svc.verifyCheckout({ ...input, signature: 'abc' }, { id: 'buyer-1' }), status(400));
    assert.equal(sql.length, 0);
    assert.equal(paid.length, 0);
  });

  it('only the payer can verify; unknown orders 404', async () => {
    const a = setup([{ rows: [order()] }]);
    await assert.rejects(a.svc.verifyCheckout(input, { id: 'someone-else' }), status(403));
    assert.equal(a.paid.length, 0);
    const b = setup([{ rows: [] }]);
    await assert.rejects(b.svc.verifyCheckout(input, { id: 'buyer-1' }), status(404));
  });

  it('503 when not configured', async () => {
    const { svc } = setup([], { provider: null });
    await assert.rejects(svc.verifyCheckout(input, { id: 'buyer-1' }), status(503));
  });
});

// ─── Webhook ────────────────────────────────────────────────────────────────

describe('PaymentsService.handleWebhook', () => {
  it('rejects a missing or bad signature with 400 and stores nothing', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, sql } = setup([]);
    await assert.rejects(svc.handleWebhook(raw, undefined, 'evt_1'), status(400));
    await assert.rejects(svc.handleWebhook(raw, `${sig.slice(0, -2)}00`, 'evt_1'), status(400));
    await assert.rejects(svc.handleWebhook(Buffer.from(`${raw.toString()} `), sig, 'evt_1'), status(400));
    assert.equal(sql.length, 0);
  });

  it('503 without a webhook secret; 500 when the raw body was not kept', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const a = setup([], { config: { keyId: 'k', keySecret: 's' } });
    await assert.rejects(a.svc.handleWebhook(raw, sig, 'evt_1'), status(503));
    const b = setup([]);
    await assert.rejects(b.svc.handleWebhook(undefined, sig, 'evt_1'), status(500));
  });

  it('payment.captured: records the event (redacted), marks the order paid and captures', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, sql, params, paid } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [order()] }, { rows: [] }, { rows: [] }]);
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_1'), { outcome: 'processed' });
    assert.match(sql[0], /INSERT INTO payment_events[\s\S]*ON CONFLICT \(event_id\) DO NOTHING/);
    assert.deepEqual(params[0].slice(0, 2), ['evt_1', 'payment.captured']);
    const stored = params[0][2] as string;
    assert.ok(!/bina@example\.com|\+919999999999|1111/.test(stored), 'no personal data stored');
    assert.match(stored, /pay_RZP/);
    assert.deepEqual(paid.map((p) => [p.providerPaymentId, p.actor]), [['pay_RZP', 'razorpay:webhook']]);
    assert.match(sql.at(-1) ?? '', /SET processed_at = NOW\(\), error = \$2/);
    assert.deepEqual(params.at(-1), ['evt_1', null]);
  });

  it('order.paid captures the same way', async () => {
    const { raw, sig } = webhook('order.paid', { ...capturedPayment(), order: { entity: { id: 'order_ABC', status: 'paid' } } });
    const { svc, paid } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [order()] }, { rows: [] }, { rows: [] }]);
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_2'), { outcome: 'processed' });
    assert.equal(paid.length, 1);
  });

  it('a redelivered, already-processed event is answered without running it again', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, sql, paid } = setup([{ rows: [] }, { rows: [{ processed_at: new Date() }] }]);
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_1'), { outcome: 'duplicate' });
    assert.equal(paid.length, 0);
    assert.equal(sql.length, 2);
  });

  it('an event seen before but never finished is run again', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, paid } = setup([{ rows: [] }, { rows: [{ processed_at: null }] }, { rows: [order()] }, { rows: [] }, { rows: [] }]);
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_1'), { outcome: 'processed' });
    assert.equal(paid.length, 1);
  });

  it('dedupes on a derived id when the event-id header is missing', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment(), 1700000123);
    const { svc, params } = setup([{ rows: [] }, { rows: [{ processed_at: new Date() }] }]);
    await svc.handleWebhook(raw, sig, undefined);
    assert.equal(params[0][0], 'payment.captured:pay_RZP:1700000123');
  });

  it('an amount mismatch is refused (200, recorded) and the order lands in unapplied', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment({ amount: 100 }));
    const { svc, sql, params, paid, notified } = setup([
      { rows: [{ id: 'ev-1' }] }, { rows: [order()] }, { rows: [{ id: 'po-1' }] }, { rows: [] }, { rows: [{ id: 'admin-1' }] },
    ]);
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_3'), { outcome: 'refused' });
    assert.equal(paid.length, 0);
    assert.ok(sql.some((q) => /SET status = 'unapplied'/.test(q)));
    assert.match(String(params.at(-1)?.[1]), /does not match/);
    assert.deepEqual(notified.map((n) => [n.userId, n.link]), [['admin-1', '/platform/payments']]);
  });

  it('ignores payments for orders that are not ours, and unrelated events (still 200)', async () => {
    const a = webhook('payment.captured', capturedPayment({ order_id: 'order_SOMEONE_ELSE' }));
    const one = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [] }, { rows: [] }]);
    assert.deepEqual(await one.svc.handleWebhook(a.raw, a.sig, 'evt_4'), { outcome: 'ignored' });
    const b = webhook('subscription.charged', { subscription: { entity: { id: 'sub_1' } } });
    const two = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [] }]);
    assert.deepEqual(await two.svc.handleWebhook(b.raw, b.sig, 'evt_5'), { outcome: 'ignored' });
  });

  it('payment.failed keeps the order open (a retry in the same checkout) and records the error', async () => {
    const { raw, sig } = webhook('payment.failed', capturedPayment({ status: 'failed', error_description: 'Card declined' }));
    const { svc, sql, params, paid } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [{ id: 'po-1' }] }, { rows: [] }]);
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_6'), { outcome: 'processed' });
    assert.ok(!sql.some((q) => /status = 'failed'/.test(q)), 'the order is not closed');
    const upd = sql.findIndex((q) => /SET last_error = [$]2/.test(q));
    assert.match(sql[upd], /status IN \('created', 'attempted'\)/);
    assert.deepEqual(params[upd], ['order_ABC', 'Card declined']);
    assert.equal(paid.length, 0);
  });

  it('a failed event followed by a fund call reuses the same order', async () => {
    const { raw, sig } = webhook('payment.failed', capturedPayment({ status: 'failed' }));
    const { svc, created } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [{ id: 'po-1' }] }, { rows: [] }, { rows: [order()] }]);
    await svc.handleWebhook(raw, sig, 'evt_6b');
    const out = await svc.openOrder(openInput);
    assert.equal(out.orderId, 'order_ABC');
    assert.equal(out.reused, true);
    assert.equal(created.length, 0, 'no second Razorpay order');
  });

  it('payment.authorized marks the order attempted', async () => {
    const { raw, sig } = webhook('payment.authorized', capturedPayment({ status: 'authorized' }));
    const { svc, sql } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [] }, { rows: [] }]);
    await svc.handleWebhook(raw, sig, 'evt_7');
    assert.ok(sql.some((q) => /SET status = 'attempted'/.test(q)));
  });

  it('refund.processed and refund.failed go to the refund handler (with our refund id from notes)', async () => {
    const RID = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const refund = (status: string, notes: unknown) => ({ refund: { entity: { id: 'rfnd_X', payment_id: 'pay_A', amount: 20000, status, notes } } });
    const p = webhook('refund.processed', refund('processed', { refundId: RID, contractId: 'CT-1' }));
    const a = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [] }]);
    assert.deepEqual(await a.svc.handleWebhook(p.raw, p.sig, 'evt_8'), { outcome: 'processed' });
    assert.deepEqual(a.refundEvents, [{ providerRefundId: 'rfnd_X', refundId: RID, status: 'processed', error: undefined, actor: 'razorpay:webhook' }]);

    const f = webhook('refund.failed', refund('failed', []));
    const b = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [] }]);
    await b.svc.handleWebhook(f.raw, f.sig, 'evt_9');
    assert.equal(b.refundEvents[0].status, 'failed');
    assert.equal(b.refundEvents[0].refundId, undefined);

    const junk = webhook('refund.processed', refund('processed', { refundId: "x' OR 1=1" }));
    const c = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [] }]);
    await c.svc.handleWebhook(junk.raw, junk.sig, 'evt_10');
    assert.equal(c.refundEvents[0].refundId, undefined, 'only a UUID is trusted as our refund id');
  });

  it('a refused capture leaves the order unapplied, writes an audit row, notifies admins and still answers 200', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, sql, params, notified } = setup([
      { rows: [{ id: 'ev-1' }] }, { rows: [order()] }, { rows: [{ id: 'po-1' }] }, { rows: [] },
      { rows: [{ id: 'admin-1' }, { id: 'admin-2' }] },
    ]);
    svc.registerPurpose('escrow_milestone', {
      onPaid: async () => { throw new ConflictException('The contract is cancelled; this payment needs a refund'); },
    });
    assert.deepEqual(await svc.handleWebhook(raw, sig, 'evt_11'), { outcome: 'refused' });
    assert.ok(!sql.some((q) => /SET status = 'paid'/.test(q)), 'never marked paid');
    const unapplied = sql.findIndex((q) => /SET status = 'unapplied'/.test(q));
    assert.deepEqual(params[unapplied].slice(0, 2), ['po-1', 'pay_RZP']);
    const audit = sql.findIndex((q) => /Payment received but not applied/.test(q));
    assert.equal(params[audit][0], 'po-1');
    assert.deepEqual(JSON.parse(String(params[audit][1])), {
      providerPaymentId: 'pay_RZP', amount: 400, currency: 'INR', reason: 'The contract is cancelled; this payment needs a refund',
    });
    assert.deepEqual(notified.map((n) => [n.userId, n.link]), [['admin-1', '/platform/payments'], ['admin-2', '/platform/payments']]);
    assert.deepEqual(params.at(-1), ['evt_11', 'Your payment was received but could not be applied (The contract is cancelled; this payment needs a refund). Our support team will refund it.']);
  });

  it('a successful capture marks the order paid only after the handler succeeded', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, sql } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [order()] }, { rows: [] }, { rows: [] }]);
    const order_: string[] = [];
    svc.registerPurpose('escrow_milestone', { onPaid: async () => { order_.push(`handler@${sql.length}`); return { alreadyCaptured: false }; } });
    await svc.handleWebhook(raw, sig, 'evt_13');
    const paidAt = sql.findIndex((q) => /SET status = 'paid'/.test(q));
    assert.equal(order_[0], 'handler@' + paidAt, 'handler ran just before the paid update');
  });

  it('verify: a refused capture answers the buyer with the handler status and a clear message', async () => {
    const { svc } = setup([{ rows: [order()] }, { rows: [{ id: 'po-1' }] }, { rows: [] }, { rows: [] }]);
    svc.registerPurpose('escrow_milestone', { onPaid: async () => { throw new ConflictException('The contract is cancelled'); } });
    await assert.rejects(
      svc.verifyCheckout({ orderId: 'order_ABC', paymentId: 'pay_RZP', signature: sign('order_ABC', 'pay_RZP') }, { id: 'buyer-1' }),
      (e: HttpException) => e.getStatus() === 409 && /payment was received.*support team will refund/.test(e.message),
    );
  });

  it('an unexpected failure is a 500 (Razorpay retries) and the event stays unprocessed', async () => {
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    const { svc, sql, params } = setup([{ rows: [{ id: 'ev-1' }] }, { rows: [order()] }, { rows: [] }, { rows: [] }]);
    svc.registerPurpose('escrow_milestone', { onPaid: async () => { throw new Error('connection reset'); } });
    await assert.rejects(svc.handleWebhook(raw, sig, 'evt_12'), status(500));
    assert.match(sql.at(-1) ?? '', /UPDATE payment_events SET error = \$2 WHERE event_id = \$1/);
    assert.ok(!sql.some((q) => /processed_at = NOW\(\)/.test(q)));
    assert.equal(params.at(-1)?.[1], 'connection reset');
  });
});

describe('checkout verify and webhook racing', () => {
  it('both reach the idempotent capture with the same ids; only one capture takes effect', async () => {
    // A capture store that behaves like markPaymentCaptured under its row lock.
    const captured = new Map<string, string>();
    let effective = 0;
    const onPaid = async (o: PaymentOrderRow, providerPaymentId: string) => {
      await new Promise((r) => setImmediate(r));
      const key = o.escrow_payment_id ?? '';
      if (captured.get(key) === providerPaymentId) return { alreadyCaptured: true };
      captured.set(key, providerPaymentId);
      effective++;
      return { alreadyCaptured: false };
    };
    const { raw, sig } = webhook('payment.captured', capturedPayment());
    // Answer by statement, since the two requests' queries interleave.
    const query = async (text: string) => {
      if (/INSERT INTO payment_events/.test(text)) return { rows: [{ id: 'ev-1' }] };
      if (/SELECT \* FROM payment_orders WHERE provider_order_id/.test(text)) return { rows: [order()] };
      return { rows: [] };
    };
    const svc = new PaymentsService({ query } as unknown as Pool, CONFIG, fakeProvider().provider);
    svc.registerPurpose('escrow_milestone', { onPaid });
    const [verify, hook] = await Promise.all([
      svc.verifyCheckout({ orderId: 'order_ABC', paymentId: 'pay_RZP', signature: sign('order_ABC', 'pay_RZP') }, { id: 'buyer-1' }),
      svc.handleWebhook(raw, sig, 'evt_race'),
    ]);
    assert.equal(effective, 1);
    assert.equal(hook.outcome, 'processed');
    assert.equal(verify.status, 'captured');
  });
});

describe('redactPayload', () => {
  it('drops personal and card fields at any depth and keeps ids and amounts', () => {
    const out = redactPayload({ a: [{ email: 'x@y', id: 'pay_1', card: { last4: '1' }, amount: 5, notes: { contact: '1' } }] });
    assert.deepEqual(out, { a: [{ id: 'pay_1', amount: 5, notes: {} }] });
  });
});

// ─── Razorpay client ────────────────────────────────────────────────────────

describe('RazorpayProvider', () => {
  const respond = (status: number, body: unknown) => async () => new Response(JSON.stringify(body), { status });

  it('creates orders with basic auth and the amount in paise', async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const http = (async (url: string, init: RequestInit) => {
      seen = { url, init };
      return new Response(JSON.stringify({ id: 'order_1', amount: 40000, currency: 'INR', status: 'created' }), { status: 200 });
    }) as unknown as typeof fetch;
    const rzp = new RazorpayProvider('rzp_test_key', 'secret', http);
    const out = await rzp.createOrder({ amountMinor: 40000, currency: 'INR', receipt: 'pay-1', notes: { a: 'b' } });
    assert.deepEqual(out, { id: 'order_1', amountMinor: 40000, currency: 'INR', status: 'created' });
    const s = seen as unknown as { url: string; init: RequestInit };
    assert.equal(s.url, 'https://api.razorpay.com/v1/orders');
    assert.equal((s.init.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('rzp_test_key:secret').toString('base64')}`);
    assert.deepEqual(JSON.parse(String(s.init.body)), { amount: 40000, currency: 'INR', receipt: 'pay-1', notes: { a: 'b' } });
  });

  it('classifies failures: 4xx rejected, 5xx and network errors unavailable; never leaks the secret', async () => {
    const reject = new RazorpayProvider('k', 'TOPSECRET', respond(400, { error: { description: 'Amount too small' } }) as unknown as typeof fetch);
    await assert.rejects(reject.refund({ paymentId: 'pay_1', amountMinor: 1, receipt: 'r', notes: {} }), (e: PaymentProviderError) =>
      e.kind === 'rejected' && /Amount too small/.test(e.message) && !/TOPSECRET/.test(e.message));
    const down = new RazorpayProvider('k', 's', respond(502, {}) as unknown as typeof fetch);
    await assert.rejects(down.createOrder({ amountMinor: 1, currency: 'INR', receipt: 'r', notes: {} }), (e: PaymentProviderError) => e.kind === 'unavailable');
    const offline = new RazorpayProvider('k', 's', (async () => { throw new TypeError('fetch failed'); }) as unknown as typeof fetch);
    await assert.rejects(offline.createOrder({ amountMinor: 1, currency: 'INR', receipt: 'r', notes: {} }), (e: PaymentProviderError) => e.kind === 'unavailable');
  });
});

describe('PaymentsService unapplied payments', () => {
  const claimed = { id: 'po-1', amount_minor: '40000', unapplied_amount_minor: null, provider_payment_id: 'pay_RZP' };

  it('refunds the full amount once and marks the order refunded', async () => {
    const { svc, sql, refunded } = setup([{ rows: [claimed] }, { rows: [] }, { rows: [] }]);
    assert.deepEqual(await svc.refundUnapplied('po-1', { id: 'admin-1' }), { status: 'refunded', refundId: 'rfnd_1' });
    assert.deepEqual(refunded, [{ paymentId: 'pay_RZP', amountMinor: 40000 }]);
    assert.ok(sql.some((q) => /SET status = 'refunded'/.test(q)));
  });

  it('a second refund finds no claimable order and never calls the provider', async () => {
    const { svc, refunded } = setup([{ rows: [] }]);
    await assert.rejects(svc.refundUnapplied('po-1', { id: 'admin-1' }), status(409));
    assert.equal(refunded.length, 0);
  });

  it('a refused provider request releases the claim; a timeout keeps it', async () => {
    for (const [kind, releases] of [['rejected', true], ['unavailable', false]] as const) {
      const provider: PaymentProvider = {
        createOrder: async () => { throw new Error('unused'); },
        refund: async () => { throw new PaymentProviderError('nope', kind); },
      };
      const { svc, sql } = setup([{ rows: [claimed] }, { rows: [] }], { provider });
      await assert.rejects(svc.refundUnapplied('po-1', { id: 'admin-1' }), status(502));
      assert.equal(sql.some((q) => /SET refunded_at = NULL/.test(q)), releases, kind);
    }
  });

  it('lists unapplied orders with the buyer and the amount actually paid', async () => {
    const { svc } = setup([{ rows: [{
      id: 'po-1', first_name: 'Bina', last_name: 'Rao', email: 'b@x.in', amount_minor: '40000', unapplied_amount_minor: '10000',
      currency: 'INR', provider_payment_id: 'pay_RZP', unapplied_reason: 'cancelled', created_at: new Date(0),
    }] }]);
    assert.deepEqual(await svc.listUnapplied(), [{
      orderId: 'po-1', buyerName: 'Bina Rao', buyerEmail: 'b@x.in', amount: 100, currency: 'INR',
      providerPaymentId: 'pay_RZP', reason: 'cancelled', createdAt: '1970-01-01T00:00:00.000Z',
    }]);
  });
});
