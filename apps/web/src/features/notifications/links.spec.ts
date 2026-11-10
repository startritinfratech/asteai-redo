import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isInternalLink } from './links';

const ORIGIN = 'https://app.asteai.test';

test('accepts same-site paths', () => {
  assert.equal(isInternalLink('/platform/contracts', ORIGIN), true);
  assert.equal(isInternalLink('/platform/studio/abc?tab=1#x', ORIGIN), true);
});

test('rejects protocol-relative and backslash links', () => {
  assert.equal(isInternalLink('//evil.com', ORIGIN), false);
  assert.equal(isInternalLink('/\\evil.com', ORIGIN), false);
  assert.equal(isInternalLink('/\\/evil.com', ORIGIN), false);
  assert.equal(isInternalLink('/%5Cevil.com', ORIGIN), true); // encoded: stays a same-origin path
});

test('rejects absolute, scheme and placeholder links', () => {
  assert.equal(isInternalLink('https://evil.com/x', ORIGIN), false);
  assert.equal(isInternalLink('javascript:alert(1)', ORIGIN), false);
  assert.equal(isInternalLink('#', ORIGIN), false);
  assert.equal(isInternalLink('', ORIGIN), false);
  assert.equal(isInternalLink(null, ORIGIN), false);
});

test('rejects control characters that URL parsers strip', () => {
  assert.equal(isInternalLink('/\t/evil.com', ORIGIN), false);
  assert.equal(isInternalLink('/\n\\evil.com', ORIGIN), false);
});
