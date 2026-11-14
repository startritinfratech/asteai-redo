import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { Request } from 'express';
import type { User } from '@asteai/types';
import { fakeConfig } from '../../test-support/fakes';
import {
  ACCESS_COOKIE, accessTokenFromCookie, cookieFromHeader, cookieSettings, readRefreshCookie, REFRESH_COOKIE,
  setSessionCookies,
} from './session-cookies';
import { safeNext } from './oauth/oauth.service';

const U1 = '11111111-1111-4111-8111-111111111111';

describe('setSessionCookies', () => {
  it('sets HttpOnly; Secure; SameSite=Lax token cookies and returns no token in the body', () => {
    const set: { name: string; value: string; opts: Record<string, unknown> }[] = [];
    const res = { cookie: (name: string, value: string, opts: Record<string, unknown>) => void set.push({ name, value, opts }) };
    const settings = cookieSettings(fakeConfig({ JWT_EXPIRES_IN: '15m', JWT_REFRESH_EXPIRES_IN: '7d' }));
    const out = setSessionCookies(res as never, { accessToken: 'jwt', refreshToken: 'rt-id.secret', user: { id: U1 } as User }, settings);

    assert.deepEqual(out, { user: { id: U1 }, sessionId: 'rt-id' });
    const by = Object.fromEntries(set.map((c) => [c.name, c]));
    for (const name of [ACCESS_COOKIE, REFRESH_COOKIE]) {
      assert.equal(by[name].opts.httpOnly, true, name);
      assert.equal(by[name].opts.secure, true, name);
      assert.equal(by[name].opts.sameSite, 'lax', name);
    }
    assert.equal(by[ACCESS_COOKIE].opts.maxAge, 15 * 60_000);
    assert.equal(by[REFRESH_COOKIE].value, `${U1}.rt-id.secret`);
    assert.equal(by[REFRESH_COOKIE].opts.path, '/api/v1/auth', 'refresh token only travels to auth endpoints');
    assert.equal(by.asteai_session.value, '1');
    assert.equal(by.asteai_session.opts.httpOnly, false, 'the hint cookie is readable, and holds no secret');
  });

  it('COOKIE_SECURE=false turns Secure off (plain-http test setups only)', () => {
    assert.equal(cookieSettings(fakeConfig({ COOKIE_SECURE: 'false' })).secure, false);
    assert.equal(cookieSettings(fakeConfig({})).secure, true);
  });
});

describe('readRefreshCookie', () => {
  const req = (v: unknown) => ({ cookies: { [REFRESH_COOKIE]: v } }) as unknown as Request;
  it('splits `<userId>.<tokenId>.<secret>`', () => {
    assert.deepEqual(readRefreshCookie(req(`${U1}.tok.sec`)), { userId: U1, refreshToken: 'tok.sec' });
  });
  it('rejects anything malformed', () => {
    for (const v of [undefined, '', 'nouser.tok.sec', `${U1}.nodot`, `${U1}`, 42, 'x'.repeat(400)]) {
      assert.equal(readRefreshCookie(req(v)), null, String(v));
    }
  });
});

describe('accessTokenFromCookie', () => {
  const extract = accessTokenFromCookie(['https://asteai.com']);
  const req = (method: string, origin?: string) =>
    ({ method, headers: origin ? { origin } : {}, cookies: { [ACCESS_COOKIE]: 'jwt' } }) as unknown as Request;

  it('reads the cookie for safe methods and for writes from the web app origin', () => {
    assert.equal(extract(req('GET', 'https://evil.asteai.com')), 'jwt');
    assert.equal(extract(req('POST', 'https://asteai.com')), 'jwt');
    assert.equal(extract(req('POST')), 'jwt', 'no Origin header (same-origin navigation, server-to-server)');
  });

  it('ignores the cookie on a write from another origin', () => {
    assert.equal(extract(req('POST', 'https://evil.asteai.com')), null);
    assert.equal(extract(req('DELETE', 'https://attacker.test')), null);
  });
});

describe('cookieFromHeader', () => {
  it('finds one cookie in a raw Cookie header', () => {
    assert.equal(cookieFromHeader('a=1; asteai_at=tok%2Ben; b=2', 'asteai_at'), 'tok+en');
    assert.equal(cookieFromHeader('xasteai_at=1', 'asteai_at'), null);
    assert.equal(cookieFromHeader(undefined, 'asteai_at'), null);
  });
});

describe('OAuth safeNext', () => {
  it('keeps same-site relative paths only', () => {
    assert.equal(safeNext('/dashboard?tab=1'), '/dashboard?tab=1');
    for (const bad of ['//evil.com', '/\\evil.com', 'https://evil.com', 'dashboard', undefined, 42]) {
      assert.equal(safeNext(bad), '/', String(bad));
    }
  });
});
