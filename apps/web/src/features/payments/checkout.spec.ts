import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutOptions, PAYMENT_MESSAGES } from './checkout';

test('checkout options pass the order exactly as the API created it', () => {
  const opts = checkoutOptions({
    orderId: 'order_1', amount: 40000, currency: 'INR', keyId: 'rzp_test_key', name: 'AsteAI escrow',
    description: 'CT-1 · milestone 1: Design', prefill: { name: 'Bina Buyer', email: 'bina@example.com' },
  });
  assert.equal(opts.key, 'rzp_test_key');
  assert.equal(opts.order_id, 'order_1');
  assert.equal(opts.amount, 40000); // paise, never re-computed in the browser
  assert.equal(opts.currency, 'INR');
  assert.deepEqual(opts.prefill, { name: 'Bina Buyer', email: 'bina@example.com' });
});

test('checkout options tolerate a missing prefill and cap the description', () => {
  const opts = checkoutOptions({
    orderId: 'order_1', amount: 1, currency: 'INR', keyId: 'k', name: 'n', description: 'x'.repeat(400),
  });
  assert.deepEqual(opts.prefill, { name: '', email: '' });
  assert.equal(String(opts.description).length, 255);
});

test('payment messages tell the buyer what happened', () => {
  assert.match(PAYMENT_MESSAGES.pending, /when the bank confirms/);
  assert.match(PAYMENT_MESSAGES.failed('Card declined'), /Card declined/);
});
