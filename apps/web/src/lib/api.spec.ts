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

describe('apiRequest 401 handling', () => {
  const store = new Map<string, string>();
  const localStorageStub = {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => void store.set(k, v),
    removeItem: (k: string) => void store.delete(k),
  };
  const g = globalThis as Record<string, unknown>;
  const realFetch = globalThis.fetch;
  let calls: string[];

  beforeEach(() => {
    store.clear();
    store.set('accessToken', 'old-access');
    store.set('refreshToken', 'rt-1');
    store.set('userId', 'u1');
    g.window = { localStorage: localStorageStub };
    g.localStorage = localStorageStub;
    calls = [];
    globalThis.fetch = (async (input: string, init?: RequestInit) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith('/auth/refresh')) {
        return new Response(JSON.stringify({ data: { accessToken: 'new-access', refreshToken: 'rt-2' } }), { status: 200 });
      }
      const auth = new Headers(init?.headers).get('Authorization');
      if (auth === 'Bearer new-access') return new Response(JSON.stringify({ data: { ok: true } }), { status: 200 });
      return new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 });
    }) as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = realFetch;
    delete g.window;
    delete g.localStorage;
  });

  test('a signed-in /auth/* endpoint refreshes and retries', async () => {
    assert.deepEqual(await api.get('/auth/2fa'), { ok: true });
    assert.deepEqual(calls.map((u) => u.replace(/^.*\/api\/v1/, '')), ['/auth/2fa', '/auth/refresh', '/auth/2fa']);
    assert.equal(store.get('refreshToken'), 'rt-2');
  });

  test('a public auth endpoint returns its 401 without refreshing', async () => {
    await assert.rejects(api.post('/auth/login', { email: 'a@b.c', password: 'x' }), (err: unknown) =>
      err instanceof ApiError && err.status === 401 && err.message === 'Unauthorized');
    assert.deepEqual(calls.map((u) => u.replace(/^.*\/api\/v1/, '')), ['/auth/login']);
    assert.equal(store.get('accessToken'), 'old-access');
  });
});
