import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { CreditPack, CreditTransactionView, WalletView } from '@asteai/types';
import {
  bestValuePackId, canUpgradeToPro, formatCredits, formatPaise, lotDetail, nextLotIds, perCredit, planSummary,
  signedAmount, txStatus, txTitle,
} from './format';

const NOW = new Date('2026-11-14T12:00:00Z');
const tx = (o: Partial<CreditTransactionView>): CreditTransactionView => ({
  id: 'tx', type: 'topup', amount: 100, remainingAmount: 100, expiresAt: null, featureKey: null,
  status: 'completed', createdAt: '2026-11-01T00:00:00Z', ...o,
});
const pack = (id: string, credits: number, priceMinor: number, listPriceMinor: number, discountPercent: number): CreditPack =>
  ({ id, credits, priceMinor, listPriceMinor, discountPercent });
const wallet = (o: Partial<WalletView>): WalletView =>
  ({ balance: 0, subscriptionTier: 'free', subscriptionStatus: null, currentPeriodEnd: null, ...o });

describe('money and credit formatting', () => {
  test('formats credits and paise for India', () => {
    assert.equal(formatCredits(1), '1 credit');
    assert.equal(formatCredits(1200), '1,200 credits');
    assert.equal(formatPaise(49900), '₹499');
    assert.equal(formatPaise(450), '₹4.50');
    assert.equal(perCredit({ priceMinor: 350000, credits: 1000 }), '₹3.50 per credit');
  });
});

describe('bestValuePackId', () => {
  test('picks the biggest discount, and none when nothing is discounted', () => {
    const packs = [pack('a', 50, 25000, 25000, 0), pack('b', 1000, 350000, 500000, 30), pack('c', 300, 120000, 150000, 20)];
    assert.equal(bestValuePackId(packs), 'b');
    assert.equal(bestValuePackId([pack('a', 50, 25000, 25000, 0)]), null);
  });
});

describe('plan', () => {
  test('summarises the plan and offers Pro only on Free', () => {
    assert.equal(planSummary(wallet({})), 'Free plan');
    assert.match(planSummary(wallet({ subscriptionStatus: 'created' })), /waiting for the first payment/);
    assert.match(planSummary(wallet({ subscriptionTier: 'pro', subscriptionStatus: 'active', currentPeriodEnd: '2026-12-14T00:00:00Z' })), /^Pro plan · renews 14 Dec 2026$/);
    assert.equal(canUpgradeToPro(wallet({})), true);
    assert.equal(canUpgradeToPro(wallet({ subscriptionTier: 'pro' })), false);
  });
});

describe('credit history', () => {
  const labels = new Map([['ai_search', 'AI search']]);

  test('titles spends and refunds by feature label', () => {
    assert.equal(txTitle(tx({ type: 'spend', amount: -15, featureKey: 'ai_search' }), labels), 'AI search');
    assert.equal(txTitle(tx({ type: 'refund', featureKey: 'ai_search' }), labels), 'Refund · AI search');
    assert.equal(txTitle(tx({ type: 'spend', featureKey: 'voice_search' }), labels), 'voice search');
    assert.equal(txTitle(tx({ type: 'grant' }), labels), 'Plan & bonus credits');
  });

  test('tags pending, refunded, expired and used-up rows', () => {
    assert.deepEqual(txStatus(tx({ status: 'pending', remainingAmount: 0 }), NOW), { label: 'Awaiting payment', color: 'amber' });
    assert.equal(txStatus(tx({ type: 'spend', amount: -5, remainingAmount: 0, status: 'refunded' }), NOW)?.label, 'Refunded');
    assert.equal(txStatus(tx({ status: 'expired', remainingAmount: 0 }), NOW)?.label, 'Expired');
    assert.equal(txStatus(tx({ expiresAt: '2026-11-10T00:00:00Z' }), NOW)?.label, 'Expired', 'past expiry, not yet swept');
    assert.equal(txStatus(tx({ remainingAmount: 0 }), NOW)?.label, 'Used up');
    assert.equal(txStatus(tx({ remainingAmount: 40 }), NOW), null);
    assert.equal(txStatus(tx({ type: 'spend', amount: -5, remainingAmount: 0 }), NOW), null);
  });

  test('shows what is left of a lot and when it expires', () => {
    assert.equal(lotDetail(tx({ amount: 100, remainingAmount: 40 })), '40 of 100 left');
    assert.match(lotDetail(tx({ type: 'grant', amount: 100, remainingAmount: 100, expiresAt: '2099-01-01T00:00:00Z' })) ?? '', /^100 of 100 left · expires 01 Jan 2099$/);
    assert.equal(lotDetail(tx({ type: 'spend', amount: -5, remainingAmount: 0 })), null);
    assert.equal(lotDetail(tx({ status: 'pending' })), null);
  });

  test('signs amounts', () => {
    assert.equal(signedAmount(tx({ amount: 1200 })), '+1,200');
    assert.equal(signedAmount(tx({ type: 'spend', amount: -15 })), '−15');
  });

  test('nextLotIds lists live lots oldest first (the FIFO order spends use)', () => {
    const txs = [
      tx({ id: 'new', createdAt: '2026-11-10T00:00:00Z' }),
      tx({ id: 'spend', type: 'spend', amount: -5, remainingAmount: 0, createdAt: '2026-11-09T00:00:00Z' }),
      tx({ id: 'old', createdAt: '2026-10-01T00:00:00Z' }),
      tx({ id: 'empty', remainingAmount: 0, createdAt: '2026-09-01T00:00:00Z' }),
      tx({ id: 'expired', expiresAt: '2026-11-01T00:00:00Z', createdAt: '2026-08-01T00:00:00Z' }),
      tx({ id: 'pending', status: 'pending', remainingAmount: 0, createdAt: '2026-07-01T00:00:00Z' }),
    ];
    assert.deepEqual(nextLotIds(txs, NOW), ['old', 'new']);
  });
});
