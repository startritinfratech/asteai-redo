import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvidence, slaLabel, splitError } from './terms';

test('split amounts must sum exactly to the held amount', () => {
  assert.equal(splitError('250', '150', 400), null);
  assert.equal(splitError('0.1', '0.2', 0.3), null);
  assert.match(splitError('250', '100', 400) ?? '', /not assigned/);
  assert.match(splitError('300', '150', 400) ?? '', /exceed/);
  assert.match(splitError('', '150', 400) ?? '', /both/i);
  assert.match(splitError('1.234', '1', 2.234) ?? '', /decimals/);
});

test('evidence must be https links, at most 10', () => {
  assert.equal(parseEvidence('https://a.example/x\n\n https://b.example ').links.length, 2);
  assert.match(parseEvidence('http://a.example').error ?? '', /https/);
  assert.match(parseEvidence('javascript:alert(1)').error ?? '', /https/);
  assert.match(parseEvidence(Array.from({ length: 11 }, (_, i) => `https://e.example/${i}`).join('\n')).error ?? '', /10/);
});

test('SLA label shows time left or overdue, only while open', () => {
  const now = Date.parse('2026-01-01T12:00:00Z');
  assert.equal(slaLabel({ status: 'open', respondBy: '2026-01-01T17:00:00Z' }, now), '5h left to respond');
  assert.equal(slaLabel({ status: 'open', respondBy: '2026-01-01T09:00:00Z' }, now), 'Overdue by 3h');
  assert.equal(slaLabel({ status: 'under_review', respondBy: '2026-01-01T09:00:00Z' }, now), null);
});
