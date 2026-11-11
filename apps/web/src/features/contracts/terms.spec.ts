import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  canCancel, milestonesError, milestoneUiActions, parseTerms, sideOf, splitEvenly, termsTotal, toMinor,
} from './terms';

test('parses and totals the terms for each model', () => {
  const hourly = parseTerms('hourly', { hourlyRate: '1500', estimatedHours: '40' });
  assert.ok(hourly.terms);
  assert.equal(termsTotal('hourly', hourly.terms), 60000);
  assert.match(parseTerms('daily', { dailyRate: '100', totalDays: '2.5' }).error ?? '', /whole number/);
  assert.match(parseTerms('fixed', { totalAmount: '' }).error ?? '', /positive/);
});

test('milestones must sum exactly to the total', () => {
  const ms = [{ title: 'a', amount: '0.1', dueDate: '' }, { title: 'b', amount: '0.2', dueDate: '' }];
  assert.equal(milestonesError(ms, 0.3), null);
  assert.match(milestonesError(ms, 0.4) ?? '', /short/);
  assert.match(milestonesError(ms, 0.2) ?? '', /exceed/);
  assert.match(milestonesError([{ title: '', amount: '1', dueDate: '' }], 1) ?? '', /title/);
});

test('splitEvenly always adds up', () => {
  const parts = splitEvenly(100, 3);
  assert.deepEqual(parts, [33.33, 33.33, 33.34]);
  assert.equal(parts.reduce((a, b) => a + toMinor(b), 0), 10000);
});

test('milestone actions follow role and status', () => {
  assert.deepEqual(milestoneUiActions('buyer', 'active', { status: 'pending', paymentPending: false }), ['fund']);
  assert.deepEqual(milestoneUiActions('buyer', 'active', { status: 'pending', paymentPending: true }), ['fund']);
  assert.deepEqual(milestoneUiActions('buyer', 'active', { status: 'submitted', paymentPending: false }), ['accept', 'request_revision']);
  assert.deepEqual(milestoneUiActions('buyer', 'active', { status: 'accepted', paymentPending: false }), ['release']);
  assert.deepEqual(milestoneUiActions('expert', 'active', { status: 'funded', paymentPending: false }), ['submit']);
  assert.deepEqual(milestoneUiActions('expert', 'active', { status: 'revision_requested', paymentPending: false }), ['submit']);
  assert.deepEqual(milestoneUiActions('expert', 'active', { status: 'submitted', paymentPending: false }), []);
  assert.deepEqual(milestoneUiActions('admin', 'active', { status: 'accepted', paymentPending: false }), []);
  assert.deepEqual(milestoneUiActions('buyer', 'pending_signature', { status: 'pending', paymentPending: false }), []);
});

test('who may cancel', () => {
  const c = { buyerId: 'b', expertId: 'e' };
  assert.equal(sideOf(c, { id: 'b', role: 'Buyer' }), 'buyer');
  assert.equal(sideOf(c, { id: 'x', role: 'Admin' }), 'admin');
  assert.equal(sideOf(c, { id: 'x', role: 'Buyer' }), null);
  const fresh = { status: 'active' as const, escrowFunded: 0, milestones: [] };
  assert.equal(canCancel('buyer', fresh), true);
  assert.equal(canCancel('buyer', { ...fresh, escrowFunded: 10 }), false);
  assert.equal(canCancel('admin', { ...fresh, escrowFunded: 10 }), true);
  assert.equal(canCancel('expert', fresh), false);
});
