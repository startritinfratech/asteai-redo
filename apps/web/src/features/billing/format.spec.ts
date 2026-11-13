import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseAccountForm, parsePayoutAmount } from './format';

const form = { method: 'bank' as const, accountHolder: 'Eshan E', accountNumber: '1234 5678 9012', ifsc: 'hdfc0001234', upiId: '' };

describe('parseAccountForm', () => {
  it('normalises a bank account', () => {
    assert.deepEqual(parseAccountForm(form).input,
      { method: 'bank', accountHolder: 'Eshan E', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
  });

  it('rejects bad IFSC, account numbers and UPI ids', () => {
    assert.match(parseAccountForm({ ...form, ifsc: 'HDFC1001234' }).error ?? '', /IFSC/);
    assert.match(parseAccountForm({ ...form, accountNumber: '1234' }).error ?? '', /9 to 18/);
    assert.match(parseAccountForm({ ...form, method: 'upi', upiId: 'nope' }).error ?? '', /UPI/);
    assert.deepEqual(parseAccountForm({ ...form, method: 'upi', upiId: ' eshan@ybl ' }).input,
      { method: 'upi', accountHolder: 'Eshan E', upiId: 'eshan@ybl' });
  });
});

describe('parsePayoutAmount', () => {
  it('accepts amounts within [minimum, available] with up to two decimals', () => {
    assert.equal(parsePayoutAmount('1,000.50', 500, 2000).amount, 1000.5);
    assert.equal(parsePayoutAmount('500', 500, 500).amount, 500);
  });

  it('refuses amounts below the minimum, above the balance, or malformed', () => {
    assert.match(parsePayoutAmount('499.99', 500, 2000).error ?? '', /minimum/);
    assert.match(parsePayoutAmount('2000.01', 500, 2000).error ?? '', /up to/);
    for (const bad of ['', 'abc', '10.123', '-5']) assert.ok(parsePayoutAmount(bad, 500, 2000).error, bad);
  });
});
