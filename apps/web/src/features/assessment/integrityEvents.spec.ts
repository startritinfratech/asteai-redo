import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventsToSend, MAX_EVENTS_PER_ANSWER, remainingEvents } from './integrityEvents';

test('counts under the cap are sent as-is', () => {
  assert.deepEqual(eventsToSend({ blur: 3, paste: 0 }), { blur: 3, paste: 0 });
});

test('counts over the cap are capped and the remainder is carried', () => {
  const pending = { blur: 120, paste: 51 };
  const sent = eventsToSend(pending);
  assert.deepEqual(sent, { blur: MAX_EVENTS_PER_ANSWER, paste: MAX_EVENTS_PER_ANSWER });
  const left = remainingEvents(pending, sent);
  assert.deepEqual(left, { blur: 70, paste: 1 });
  assert.deepEqual(eventsToSend(left), { blur: 50, paste: 1 });
});

test('events that arrive while a send is in flight are kept', () => {
  const sent = eventsToSend({ blur: 60, paste: 2 });
  // Two more blurs happened before the response came back.
  assert.deepEqual(remainingEvents({ blur: 62, paste: 2 }, sent), { blur: 12, paste: 0 });
});

test('never sends a negative or fractional count', () => {
  assert.deepEqual(eventsToSend({ blur: -4, paste: 2.7 }), { blur: 0, paste: 2 });
});
