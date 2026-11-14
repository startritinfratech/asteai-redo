import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCsp, buildSecurityHeaders, originOf } from '../securityHeaders';

const directive = (csp: string, name: string) =>
  csp.split('; ').find((d) => d.startsWith(`${name} `))?.slice(name.length + 1).split(' ') ?? [];

test('production CSP: no eval, no plugins, no framing, upgrades http', () => {
  const csp = buildCsp({ apiUrl: 'https://api.asteai.com/api/v1' });
  assert.ok(!directive(csp, 'script-src').includes("'unsafe-eval'"));
  assert.deepEqual(directive(csp, 'object-src'), ["'none'"]);
  assert.deepEqual(directive(csp, 'frame-ancestors'), ["'none'"]);
  assert.deepEqual(directive(csp, 'form-action'), ["'self'"]);
  assert.ok(csp.endsWith('upgrade-insecure-requests'));
});

test('connect-src allows the API origin (path stripped) and its websocket form', () => {
  const connect = directive(buildCsp({ apiUrl: 'https://api.asteai.com/api/v1' }), 'connect-src');
  assert.ok(connect.includes('https://api.asteai.com'));
  assert.ok(connect.includes('wss://api.asteai.com'));
  assert.ok(!connect.some((c) => c.includes('/api/v1')));
});

test('a separate websocket URL is allowed too', () => {
  const connect = directive(buildCsp({ apiUrl: 'https://api.asteai.com', wsUrl: 'https://rt.asteai.com' }), 'connect-src');
  assert.ok(connect.includes('wss://rt.asteai.com'));
});

test('dev adds eval (React refresh) and drops HSTS / upgrade', () => {
  const csp = buildCsp({ dev: true });
  assert.ok(directive(csp, 'script-src').includes("'unsafe-eval'"));
  assert.ok(!csp.includes('upgrade-insecure-requests'));
  assert.ok(!buildSecurityHeaders({ dev: true }).some((h) => h.key === 'Strict-Transport-Security'));
  assert.ok(buildSecurityHeaders({}).some((h) => h.key === 'Strict-Transport-Security'));
});

test('the third parties the app loads are allowed exactly where needed', () => {
  const csp = buildCsp({});
  assert.ok(directive(csp, 'script-src').includes('https://challenges.cloudflare.com'));
  assert.ok(directive(csp, 'frame-src').includes('https://challenges.cloudflare.com'));
  assert.ok(directive(csp, 'script-src').includes('https://checkout.razorpay.com'));
  assert.ok(directive(csp, 'frame-src').includes('https://api.razorpay.com'));
  assert.ok(directive(csp, 'media-src').includes('blob:'));
});

test('originOf ignores bad input', () => {
  assert.equal(originOf(undefined), null);
  assert.equal(originOf('/api/v1'), null);
  assert.equal(originOf('http://localhost:3001/api'), 'http://localhost:3001');
});

test('connect-src allows the résumé bucket origin for direct S3 uploads, and nothing broader', () => {
  const connect = directive(buildCsp({ uploadUrl: 'https://asteai-resumes.s3.ap-south-1.amazonaws.com/some/path' }), 'connect-src');
  assert.ok(connect.includes('https://asteai-resumes.s3.ap-south-1.amazonaws.com'));
  assert.ok(!connect.some((c) => c.includes('*')));
  assert.ok(!directive(buildCsp({}), 'connect-src').some((c) => c.includes('amazonaws')));
});

test('the microphone stays limited to our own origin (voice interviews)', () => {
  const pp = buildSecurityHeaders({}).find((h) => h.key === 'Permissions-Policy')?.value ?? '';
  assert.match(pp, /microphone=\(self\)/);
});
