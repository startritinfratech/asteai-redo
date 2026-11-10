import { test } from 'node:test';
import assert from 'node:assert/strict';
import { latestConsentByPurpose } from './consents';

const row = (id: string, purpose: string, status: string, created_at: string) => ({ id, purpose, status, created_at });

test('picks the newest row per purpose regardless of order', () => {
  const latest = latestConsentByPurpose([
    row('3', 'A', 'Active', '2026-03-01T00:00:00Z'),
    row('1', 'A', 'Revoked', '2026-01-01T00:00:00Z'),
    row('2', 'B', 'Revoked', '2026-02-01T00:00:00Z'),
  ]);
  assert.equal(latest.get('A')?.id, '3');
  assert.equal(latest.get('B')?.id, '2');
});

test('the oldest row does not win (grant then revoke)', () => {
  const latest = latestConsentByPurpose([
    row('1', 'A', 'Active', '2026-01-01T00:00:00Z'),
    row('2', 'A', 'Revoked', '2026-01-02T00:00:00Z'),
  ]);
  assert.equal(latest.get('A')?.status, 'Revoked');
});

test('equal timestamps resolve to the later row in the list', () => {
  const latest = latestConsentByPurpose([
    row('1', 'A', 'Active', '2026-01-01T00:00:00Z'),
    row('2', 'A', 'Revoked', '2026-01-01T00:00:00Z'),
  ]);
  assert.equal(latest.get('A')?.id, '2');
});

test('handles missing data', () => {
  assert.equal(latestConsentByPurpose(undefined).size, 0);
});
