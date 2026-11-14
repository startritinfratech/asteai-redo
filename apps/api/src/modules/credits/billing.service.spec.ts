import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { fakeDb, type Route } from '../../test-support/fakes';
import { verifyWebhookSignature } from '../payments/signatures';
import { BillingService } from './billing.service';
import { CreditsService } from './credits.service';
import type { BillingConfig, BillingProvider } from './razorpay-billing';

const SECRET = 'whsec_test_credits';
const sign = (raw: Buffer, secret = SECRET) => createHmac('sha256', secret).update(raw).digest('hex');
const body = (obj: unknown) => Buffer.from(JSON.stringify(obj));

const orderPaid = (amountPaid = 9900) => body({
  event: 'order.paid',
  payload: {
    order: { entity: { id: 'order_1', amount_paid: amountPaid } },
    payment: { entity: { id: 'pay_1', order_id: 'order_1', amount: amountPaid } },
  },
});

/** A pending top-up for order_1: 120 credits for ₹99. */
function topupRoutes(status = 'pending'): Route[] {
  return [
    [/WHERE type = 'topup' AND reference = \$1 FOR UPDATE/, [{ id: 'tx-1', user_id: 'user-1', amount: 120, status, metadata: { priceMinor: 9900 } }]],
    [/^INSERT INTO wallets/, []],
    [/^SELECT 1 FROM wallets/, [{}]],
    [/^WITH stale AS/, [{ balance: 0, subscription_tier: 'free', subscription_status: null, current_period_end: null }]],
    [/SET status = 'completed', remaining_amount = amount/, []],
    [/^UPDATE wallets SET balance = balance \+ \$2/, [{ balance: 120 }]],
  ];
}

function billing(routes: Route[], config: BillingConfig = { keyId: 'rzp_test_x', keySecret: 'key_secret', webhookSecret: SECRET }) {
  const db = fakeDb(routes);
  const provider = {} as BillingProvider;
  return { svc: new BillingService(db.pool, new CreditsService(db.pool), config, provider), db };
}

describe('verifyWebhookSignature', () => {
  const raw = orderPaid();

  it('accepts the HMAC-SHA256 hex digest of the exact raw body (any case, surrounding space)', () => {
    assert.equal(verifyWebhookSignature(raw, sign(raw), SECRET), true);
    assert.equal(verifyWebhookSignature(raw, ` ${sign(raw).toUpperCase()} `, SECRET), true);
  });

  it('rejects a wrong secret, a tampered body, a truncated or missing signature, and an empty secret', () => {
    assert.equal(verifyWebhookSignature(raw, sign(raw, 'other'), SECRET), false);
    assert.equal(verifyWebhookSignature(orderPaid(1), sign(raw), SECRET), false);
    assert.equal(verifyWebhookSignature(raw, sign(raw).slice(0, 63), SECRET), false);
    assert.equal(verifyWebhookSignature(raw, undefined, SECRET), false);
    assert.equal(verifyWebhookSignature(raw, sign(raw, ''), ''), false);
  });

  it('is sensitive to re-serialisation (whitespace changes the bytes)', () => {
    const pretty = Buffer.from(JSON.stringify(JSON.parse(raw.toString()), null, 2));
    assert.equal(verifyWebhookSignature(pretty, sign(raw), SECRET), false);
  });
});

describe('BillingService.listPacks', () => {
  it('reports each pack discount and leaves mispriced packs (over 30% off, or above list) off sale', async () => {
    const { svc } = billing([[/key = 'credit_packs'/, [{ value: [
      { id: 'starter', credits: 50, priceMinor: 25000, listPriceMinor: 25000 },
      { id: 'bulk', credits: 1000, priceMinor: 350000, listPriceMinor: 500000 },
      { id: 'too-cheap', credits: 1000, priceMinor: 300000, listPriceMinor: 500000 },
      { id: 'above-list', credits: 10, priceMinor: 6000, listPriceMinor: 5000 },
      { id: 'no-list', credits: 10, priceMinor: 5000 },
      { id: 'junk', credits: -1, priceMinor: 5000 },
    ] }]]]);
    assert.deepEqual(await svc.listPacks(), [
      { id: 'starter', credits: 50, priceMinor: 25000, listPriceMinor: 25000, discountPercent: 0 },
      { id: 'bulk', credits: 1000, priceMinor: 350000, listPriceMinor: 500000, discountPercent: 30 },
      { id: 'no-list', credits: 10, priceMinor: 5000, listPriceMinor: 5000, discountPercent: 0 },
    ]);
  });
});

describe('BillingService.handleWebhook', () => {
  it('400s a missing or invalid signature before reading the body or touching the database', async () => {
    const { svc, db } = billing(topupRoutes());
    const raw = orderPaid();
    await assert.rejects(svc.handleWebhook(raw, undefined), BadRequestException);
    await assert.rejects(svc.handleWebhook(raw, sign(raw, 'attacker')), BadRequestException);
    await assert.rejects(svc.handleWebhook(orderPaid(999_999), sign(raw)), BadRequestException);
    assert.equal(db.log.length, 0);
  });

  it('credits a signed order.paid top-up once, inside a transaction', async () => {
    const { svc, db } = billing(topupRoutes());
    const raw = orderPaid();
    assert.deepEqual(await svc.handleWebhook(raw, sign(raw)), { outcome: 'processed' });
    assert.deepEqual(db.all(/SET status = 'completed', remaining_amount = amount/)[0].params, ['tx-1', 'pay_1']);
    assert.deepEqual(db.all(/^UPDATE wallets SET balance/)[0].params, ['user-1', 120]);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('treats a retried event (top-up no longer pending) as a duplicate', async () => {
    const { svc, db } = billing(topupRoutes('completed'));
    const raw = orderPaid();
    assert.deepEqual(await svc.handleWebhook(raw, sign(raw)), { outcome: 'duplicate' });
    assert.equal(db.all(/^UPDATE wallets SET balance/).length, 0);
  });

  it('refuses a payment whose amount is not the pack price', async () => {
    const { svc, db } = billing(topupRoutes());
    const raw = orderPaid(100);
    assert.deepEqual(await svc.handleWebhook(raw, sign(raw)), { outcome: 'refused' });
    assert.equal(db.all(/^UPDATE wallets SET balance/).length, 0);
  });

  it('ignores signed events for orders that are not credit top-ups (e.g. escrow payments)', async () => {
    const { svc } = billing([[/WHERE type = 'topup' AND reference/, []]]);
    const raw = orderPaid();
    assert.deepEqual(await svc.handleWebhook(raw, sign(raw)), { outcome: 'ignored' });
  });

  it('grants Pro credits on subscription.charged, keyed by payment id', async () => {
    const raw = body({
      event: 'subscription.charged',
      payload: {
        subscription: { entity: { id: 'sub_1', status: 'active', current_end: 1_800_000_000 } },
        payment: { entity: { id: 'pay_9', amount: 49900 } },
      },
    });
    const { svc, db } = billing([
      [/FROM wallets w CROSS JOIN plans p/, [{ user_id: 'user-1', price_minor: 49900, monthly_credits: 100 }]],
      [/SET subscription_tier = 'pro'/, []],
      [/^INSERT INTO wallets/, []],
      [/^SELECT 1 FROM wallets/, [{}]],
      [/^WITH stale AS/, [{ balance: 0 }]],
      [/ON CONFLICT \(type, reference\)/, [{ id: 'grant-1' }]],
      [/^UPDATE wallets SET balance = balance \+ \$2/, [{ balance: 100 }]],
    ]);
    assert.deepEqual(await svc.handleWebhook(raw, sign(raw)), { outcome: 'processed' });
    const [grant] = db.all(/ON CONFLICT \(type, reference\)/);
    assert.deepEqual(grant.params.slice(0, 3), ['user-1', 'grant', 100]);
    assert.deepEqual(grant.params[3], new Date(1_800_000_000 * 1000));
    assert.equal(grant.params[5], 'pay_9');
  });

  it('drops the tier to free when the subscription is cancelled or halted', async () => {
    const raw = body({ event: 'subscription.cancelled', payload: { subscription: { entity: { id: 'sub_1', status: 'cancelled' } } } });
    const { svc, db } = billing([[/^UPDATE wallets\s+SET subscription_status/, [{}]]]);
    assert.deepEqual(await svc.handleWebhook(raw, sign(raw)), { outcome: 'processed' });
    assert.deepEqual(db.all(/SET subscription_status/)[0].params, ['sub_1', 'cancelled', true]);
  });

  it('503s when no webhook secret is configured', async () => {
    const { svc } = billing([], { keyId: 'k', keySecret: 's' });
    const raw = orderPaid();
    await assert.rejects(svc.handleWebhook(raw, sign(raw)), ServiceUnavailableException);
  });
});
