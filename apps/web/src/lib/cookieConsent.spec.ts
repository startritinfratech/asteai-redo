import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALL_GRANTED, CONSENT_COOKIE, CONSENT_VERSION, parseConsentCookie, serializeConsentCookie, withGpc,
} from './cookieConsent';

const state = { ...ALL_GRANTED, analytics: false, ts: '2026-11-12T00:00:00.000Z' };

test('round-trips through the cookie string', () => {
  const cookie = serializeConsentCookie(state, true).split(';')[0];
  assert.deepEqual(parseConsentCookie(`other=1; ${cookie}; x=y`), state);
});

test('no cookie, malformed JSON or another version means no choice yet', () => {
  assert.equal(parseConsentCookie('other=1'), null);
  assert.equal(parseConsentCookie(`${CONSENT_COOKIE}=%7Bnope`), null);
  const old = encodeURIComponent(JSON.stringify({ ...state, v: CONSENT_VERSION + 1 }));
  assert.equal(parseConsentCookie(`${CONSENT_COOKIE}=${old}`), null);
});

test('non-boolean values are treated as not granted', () => {
  const odd = encodeURIComponent(JSON.stringify({ v: CONSENT_VERSION, analytics: 'yes', marketing: 1, functional: true }));
  const parsed = parseConsentCookie(`${CONSENT_COOKIE}=${odd}`);
  assert.equal(parsed?.analytics, false);
  assert.equal(parsed?.marketing, false);
  assert.equal(parsed?.functional, true);
});

test('Global Privacy Control forces marketing off and leaves the rest', () => {
  assert.deepEqual(withGpc(ALL_GRANTED, true), { ...ALL_GRANTED, marketing: false });
  assert.deepEqual(withGpc(ALL_GRANTED, false), ALL_GRANTED);
});

test('Secure is only added on https', () => {
  assert.match(serializeConsentCookie(state, true), /; Secure$/);
  assert.doesNotMatch(serializeConsentCookie(state, false), /Secure/);
});
