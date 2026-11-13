import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeNext } from '../../lib/routes';
import { normalisePhone, validateCareer, validateContact, validateLeadStep, validateNewsletter } from './validate';

test('contact: mirrors the API lengths', () => {
  assert.deepEqual(Object.keys(validateContact({ name: 'J', email: 'x', subject: 'Hi', message: 'short' })).sort(),
    ['email', 'message', 'name', 'subject']);
  assert.deepEqual(validateContact({ name: 'Jane', email: 'jane@acme.com', subject: 'Pricing', message: 'Tell me more please' }), {});
});

test('lead steps validate only their own fields', () => {
  assert.deepEqual(Object.keys(validateLeadStep(0, { roleTitle: 'x' })), ['roleTitle']);
  assert.deepEqual(validateLeadStep(1, { skills: 'PyTorch' }), {});
  const step3 = validateLeadStep(2, { company: 'Acme', contactName: 'Jane', email: 'jane@acme.com', phone: '98765 43210' });
  assert.deepEqual(Object.keys(step3), ['phone']);
  assert.deepEqual(validateLeadStep(2, { company: 'Acme', contactName: 'Jane', email: 'jane@acme.com', phone: '+91 (98765) 43-210' }), {});
  assert.equal(normalisePhone('+91 (98765) 43-210'), '+919876543210');
});

test('careers: role required, profile link must be http(s)', () => {
  const base = { roleSlug: 'eng', fullName: 'Ravi Kumar', email: 'r@x.com', profileUrl: '', message: '' };
  assert.deepEqual(validateCareer(base), {});
  assert.deepEqual(Object.keys(validateCareer({ ...base, roleSlug: '', profileUrl: 'javascript:alert(1)' })).sort(), ['profileUrl', 'roleSlug']);
  assert.deepEqual(Object.keys(validateCareer({ ...base, profileUrl: 'github.com/ravi' })), ['profileUrl']);
});

test('newsletter email', () => {
  assert.ok(validateNewsletter(''));
  assert.ok(validateNewsletter('nope'));
  assert.equal(validateNewsletter('a@b.co'), undefined);
});

test('safeNext keeps same-site paths and refuses open redirects and auth loops', () => {
  assert.equal(safeNext('/jobs/REQ-1'), '/jobs/REQ-1');
  assert.equal(safeNext('/platform/applications?x=1'), '/platform/applications?x=1');
  for (const bad of [null, '', 'https://evil.com', '//evil.com', '/\\evil.com', '/auth/login', '/auth', 'jobs']) {
    assert.equal(safeNext(bad), null, String(bad));
  }
});
