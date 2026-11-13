import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceTarget } from '@asteai/types';
import { matchLocally } from './localIntent';

const targets: VoiceTarget[] = [
  { id: 'route:applications', kind: 'route', label: 'My Applications' },
  { id: 'route:passport', kind: 'route', label: 'Talent Passport' },
  { id: 'action:proposals.award', kind: 'action', label: 'Award', confirm: true },
  { id: 'field:search', kind: 'field', label: 'Search' },
];

describe('matchLocally', () => {
  it('handles back and scroll', () => {
    assert.equal(matchLocally('Go back', targets)?.kind, 'back');
    const scroll = matchLocally('scroll down.', targets);
    assert.deepEqual([scroll?.kind, scroll?.value], ['scroll', 'down']);
  });

  it('opens a page by label, ignoring "my", "the" and "page"', () => {
    assert.equal(matchLocally('open applications', targets)?.targetId, 'route:applications');
    assert.equal(matchLocally('Show me the talent passport page', targets)?.targetId, 'route:passport');
  });

  it('presses an action and keeps its confirm flag', () => {
    const r = matchLocally('click award', targets);
    assert.deepEqual([r?.kind, r?.targetId, r?.needsConfirmation], ['invoke', 'action:proposals.award', true]);
  });

  it('never matches fields locally (they need a value)', () => {
    assert.equal(matchLocally('open search', targets), null);
  });

  it('leaves unknown pages and questions to the server', () => {
    assert.equal(matchLocally('open settings', targets), null);
    assert.equal(matchLocally('what is a passport?', targets), null);
  });
});
