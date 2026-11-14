import { afterEach, beforeEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { api, ApiError, refreshesOn401 } from './api';

describe('refreshesOn401', () => {
  test('never refreshes for the public auth endpoints', () => {
    for (const path of [
      '/auth/login', '/auth/login/2fa', '/auth/register', '/auth/refresh', '/auth/logout',
      '/auth/password/forgot', '/auth/password/reset', '/auth/verify-email',
    ]) {
      assert.equal(refreshesOn401(path), false, path);
    }
  });

  test('ignores a query string or hash on a public endpoint', () => {
    assert.equal(refreshesOn401('/auth/verify-email?token=x'), false);
    assert.equal(refreshesOn401('/auth/login#x'), false);
  });

  test('refreshes for the signed-in /auth/* endpoints (exact match, not prefix)', () => {
    for (const path of [
      '/auth/verify-email/send', '/auth/2fa', '/auth/2fa/setup', '/auth/2fa/enable', '/auth/2fa/disable',
      '/auth/sessions', '/auth/sessions/abc', '/auth/password/change', '/auth/login/2fa/extra',
    ]) {
      assert.equal(refreshesOn401(path), true, path);
    }
  });

  test('refreshes for everything else', () => {
    assert.equal(refreshesOn401('/users/me'), true);
    assert.equal(refreshesOn401('/requisitions'), true);
  });
});

describe('apiRequest 401 handling (HttpOnly cookie session)', () => {
  const g = globalThis as Record<string, unknown>;
  const realFetch = globalThis.fetch;
  let calls: { path: string; init?: RequestInit }[];
  /** Whether the "browser" holds a fresh access cookie (set by a successful refresh). */
  let fresh: boolean;
  let refreshOk: boolean;

  beforeEach(() => {
    g.document = { cookie: 'theme=dark; asteai_session=1' };
    calls = [];
    fresh = false;
    refreshOk = true;
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const path = String(input).replace(/^.*\/api\/v1/, '');
      calls.push({ path, init });
      if (path === '/auth/refresh') {
        if (refreshOk) fresh = true;
        return new Response(null, { status: refreshOk ? 200 : 401 });
      }
      if (fresh) return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete g.document;
  });

  test('sends cookies, never an Authorization header', async () => {
    fresh = true;
    await api.get('/users/me');
    assert.equal(calls[0].init?.credentials, 'include');
    assert.equal(new Headers(calls[0].init?.headers).get('Authorization'), null);
  });

  test('a signed-in /auth/* endpoint refreshes (cookie only, no body) and retries', async () => {
    assert.deepEqual(await api.get('/auth/2fa'), { ok: true });
    assert.deepEqual(calls.map((c) => c.path), ['/auth/2fa', '/auth/refresh', '/auth/2fa']);
    assert.equal(calls[1].init?.credentials, 'include');
    assert.equal(calls[1].init?.body, undefined);
  });

  test('a public auth endpoint returns its 401 without refreshing', async () => {
    await assert.rejects(api.post('/auth/login', { email: 'a@b.c', password: 'x' }), (err: unknown) =>
      err instanceof ApiError && err.status === 401 && err.message === 'Unauthorized');
    assert.deepEqual(calls.map((c) => c.path), ['/auth/login']);
  });

  test('an anonymous visitor (no session hint cookie) never triggers a refresh', async () => {
    (g.document as { cookie: string }).cookie = 'theme=dark';
    await assert.rejects(api.get('/users/me'), (err: unknown) => err instanceof ApiError && err.status === 401);
    assert.deepEqual(calls.map((c) => c.path), ['/users/me']);
  });

  test('a refused refresh still retries once (another tab may have rotated the cookies)', async () => {
    refreshOk = false;
    await assert.rejects(api.get('/users/me'), (err: unknown) => err instanceof ApiError && err.status === 401);
    assert.deepEqual(calls.map((c) => c.path), ['/users/me', '/auth/refresh', '/users/me']);
  });
});
