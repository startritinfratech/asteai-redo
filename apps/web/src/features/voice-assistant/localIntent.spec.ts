import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { VoiceTarget } from '@asteai/types';
import { confirmationReply, matchLocally, spokenInteger } from './localIntent';

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

  it('handles polite navigation and gives exact field commands a local path', () => {
    assert.equal(matchLocally('Hey AsteAI, could you please take me to my applications?', targets)?.targetId, 'route:applications');
    const filled = matchLocally('Please fill search with C++ / Node.js', targets);
    assert.deepEqual([filled?.kind, filled?.targetId, filled?.value], ['fill', 'field:search', 'C++ / Node.js']);
    assert.equal(matchLocally('set missing to C++', targets), null);
  });

  it('leaves unknown pages and questions to the server', () => {
    assert.equal(matchLocally('open settings', targets), null);
    assert.equal(matchLocally('what is a passport?', targets), null);
  });

  it('clarifies a hiring request and handles the short route answer locally', () => {
    const hiring: VoiceTarget[] = [
      { id: 'route:pipeline', kind: 'route', label: 'Applications Pipeline' },
      { id: 'route:pools', kind: 'route', label: 'Talent CRM' },
    ];
    assert.equal(matchLocally('Where can I see candidates?', hiring)?.kind, 'clarify');
    assert.equal(matchLocally('The talent pool.', hiring, true)?.targetId, 'route:pools');
    assert.equal(matchLocally('award', targets, true), null);
  });

  it('routes requests only to available job and support actions', () => {
    const employer: VoiceTarget[] = [
      { id: 'route:hire/job-creator', kind: 'route', label: 'AI Job Creator' },
      { id: 'route:support', kind: 'route', label: 'Help & Support' },
      { id: 'action:job-creator.generate', kind: 'action', label: 'Generate job (5 credits)', confirm: true },
    ];
    assert.equal(matchLocally('I want to post a job', employer)?.targetId, 'route:hire/job-creator');
    assert.equal(matchLocally('I want to post a job', targets), null);
    assert.equal(matchLocally('Can you speak to a human?', employer)?.targetId, 'route:support');
    assert.equal(matchLocally('Generate job', employer)?.needsConfirmation, true);
  });

  it('uses explicit confirmation and handles common spoken headcounts', () => {
    assert.equal(confirmationReply('Yes, do it.'), 'confirm');
    assert.equal(confirmationReply('No, do not confirm.'), null);
    assert.equal(confirmationReply('Cancel.'), 'cancel');
    assert.equal(spokenInteger('two'), 2);
    assert.equal(spokenInteger('20'), 20);
    assert.equal(spokenInteger('2.5'), -1);
  });
});
