import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fourFifthsReport } from './fairness';

test('flags a group whose rate is below 80% of the highest rate', () => {
  const r = fourFifthsReport([
    { group: 'en', total: 100, selected: 50 }, // 0.5 (max)
    { group: 'hi', total: 100, selected: 30 }, // 0.3 → 0.6
  ]);
  assert.equal(r.overall, 'Review');
  assert.equal(r.groups[0].status, 'Pass');
  assert.equal(r.groups[1].status, 'Review');
  assert.ok(Math.abs((r.groups[1].impactRatio ?? 0) - 0.6) < 1e-9);
});

test('exactly 4/5ths passes', () => {
  const r = fourFifthsReport([
    { group: 'a', total: 10, selected: 5 },
    { group: 'b', total: 10, selected: 4 },
  ]);
  assert.equal(r.groups[1].status, 'Pass');
  assert.equal(r.overall, 'Pass');
});

test('groups without candidates are not judged', () => {
  const r = fourFifthsReport([
    { group: 'a', total: 10, selected: 5 },
    { group: 'b', total: 0, selected: 0 },
  ]);
  assert.equal(r.groups[1].status, 'No data');
  assert.equal(r.groups[1].rate, null);
  assert.equal(r.overall, 'Pass');
});

test('no selections anywhere is not a disparity', () => {
  const r = fourFifthsReport([
    { group: 'a', total: 10, selected: 0 },
    { group: 'b', total: 5, selected: 0 },
  ]);
  assert.equal(r.overall, 'Pass');
});

test('no data at all', () => {
  assert.equal(fourFifthsReport([]).overall, 'No data');
});
