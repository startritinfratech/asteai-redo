import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { fakeConfig, fakeDb, type Route } from '../../../test-support/fakes';
import { handshakeToken } from '../../chats/chats.gateway';
import type { TwoFactorService } from '../two-factor.service';
import { OAuthService } from './oauth.service';

const jwt = new JwtService({ secret: 'x'.repeat(32) });
const config = fakeConfig({
  GOOGLE_CLIENT_ID: 'gid', GOOGLE_CLIENT_SECRET: 'gsecret',
  GITHUB_CLIENT_ID: 'hid', GITHUB_CLIENT_SECRET: 'hsecret',
  OAUTH_CALLBACK_BASE_URL: 'https://api.asteai.test',
});
const twoFactor = { startLogin: async (user: { id: string }) => ({ accessToken: 'at', refreshToken: 'r.s', user }) } as unknown as TwoFactorService;

/** Fake provider endpoints: token exchange plus Google userinfo. */
function http(profile: Record<string, unknown>) {
  const calls: { url: string; body?: string }[] = [];
  const fn = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? String(init.body) : undefined });
    if (url.includes('/token')) return new Response(JSON.stringify({ access_token: 'provider-token' }), { status: 200 });
    return new Response(JSON.stringify(profile), { status: 200 });
  }) as typeof fetch;
  return { fn, calls };
}

const userRow = { id: 'u1', email: 'a@example.test', first_name: 'A', last_name: 'B', role: 'Candidate', is_banned: false, is_suspended: false, suspended_until: null };

describe('OAuthService', () => {
  it('start(): Google gets state + PKCE S256, the exact callback URL, and a signed state cookie', () => {
    const svc = new OAuthService(fakeDb([]).pool, config, jwt, twoFactor);
    const { url, stateCookie } = svc.start('google', '/jobs');
    const q = new URL(url).searchParams;
    assert.equal(q.get('redirect_uri'), 'https://api.asteai.test/api/v1/auth/oauth/google/callback');
    assert.equal(q.get('code_challenge_method'), 'S256');
    const saved = jwt.verify<{ state: string; verifier: string; next: string }>(stateCookie);
    assert.equal(saved.state, q.get('state'));
    assert.ok(saved.verifier);
    assert.equal(saved.next, '/jobs');
  });

  it('start(): keeps a self-serve role for new accounts, and drops anything else', () => {
    const svc = new OAuthService(fakeDb([]).pool, config, jwt, twoFactor);
    assert.equal(jwt.verify<{ role: string }>(svc.start('github', '/', 'Freelancer').stateCookie).role, 'Freelancer');
    assert.equal(jwt.verify<{ role: string }>(svc.start('github', '/', 'Admin').stateCookie).role, 'Candidate');
    assert.equal(jwt.verify<{ role: string }>(svc.start('github', '/').stateCookie).role, 'Candidate');
  });

  it('callback(): creates a new account in the role picked at sign-up', async () => {
    const h = http({ sub: 'g-2', email: 'new@example.test', email_verified: true, name: 'New Person' });
    const db = fakeDb([[/^INSERT INTO user_accounts/, [{ ...userRow, id: 'u2', role: 'Buyer' }]]]);
    const svc = new OAuthService(db.pool, config, jwt, twoFactor, h.fn);
    const { url, stateCookie } = svc.start('google', '/', 'Buyer');
    await svc.callback('google', 'code', new URL(url).searchParams.get('state'), stateCookie, {});
    assert.equal(db.all(/^INSERT INTO user_accounts/)[0].params[5], 'Buyer');
  });

  it('start(): 404 for a provider without credentials', () => {
    const svc = new OAuthService(fakeDb([]).pool, fakeConfig({}), jwt, twoFactor);
    assert.throws(() => svc.start('github', '/'), NotFoundException);
  });

  it('callback(): refuses a state that does not match the cookie (CSRF), before calling the provider', async () => {
    const h = http({});
    const svc = new OAuthService(fakeDb([]).pool, config, jwt, twoFactor, h.fn);
    const { stateCookie } = svc.start('google', '/');
    await assert.rejects(svc.callback('google', 'code', 'forged', stateCookie, {}), UnauthorizedException);
    await assert.rejects(svc.callback('github', 'code', 'x', stateCookie, {}), UnauthorizedException, 'cookie from another provider');
    await assert.rejects(svc.callback('google', 'code', 'x', undefined, {}), UnauthorizedException);
    assert.equal(h.calls.length, 0);
  });

  it('callback(): refuses an email the provider has not verified', async () => {
    const h = http({ sub: 'g-1', email: 'a@example.test', email_verified: false });
    const svc = new OAuthService(fakeDb([]).pool, config, jwt, twoFactor, h.fn);
    const { url, stateCookie } = svc.start('google', '/');
    const state = new URL(url).searchParams.get('state');
    await assert.rejects(svc.callback('google', 'code', state, stateCookie, {}), ForbiddenException);
  });

  it('callback(): links a verified Google identity to the existing account with that email', async () => {
    const h = http({ sub: 'g-1', email: 'A@Example.test', email_verified: true, name: 'A B' });
    const routes: Route[] = [
      [/FROM user_oauth_identities WHERE provider/, []],
      [/WHERE \(email_canonical = LOWER\(\$1\)/, [userRow]],
    ];
    const db = fakeDb(routes);
    const svc = new OAuthService(db.pool, config, jwt, twoFactor, h.fn);
    const { url, stateCookie } = svc.start('google', '/jobs');
    const state = new URL(url).searchParams.get('state');

    const out = await svc.callback('google', 'code', state, stateCookie, {});
    assert.equal(out.kind, 'session');
    assert.equal(out.next, '/jobs');
    assert.match(h.calls[0].body ?? '', /code_verifier=/);
    assert.equal(db.all(/^INSERT INTO user_accounts/).length, 0, 'no duplicate account');
    assert.deepEqual(db.all(/INSERT INTO user_oauth_identities/)[0].params, ['google', 'g-1', 'u1', 'a@example.test']);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });
});

describe('chat handshake cookie auth', () => {
  const sock = (headers: Record<string, string>, auth: unknown = {}) =>
    ({ handshake: { auth, headers } }) as unknown as Parameters<typeof handshakeToken>[0];
  const origins = () => ['https://asteai.com'];

  it('uses the access cookie only from the web app origin', () => {
    assert.equal(handshakeToken(sock({ origin: 'https://asteai.com', cookie: 'asteai_at=jwt' }), origins), 'jwt');
    assert.equal(handshakeToken(sock({ origin: 'https://evil.test', cookie: 'asteai_at=jwt' }), origins), null);
    assert.equal(handshakeToken(sock({ cookie: 'asteai_at=jwt' }), origins), null);
  });

  it('still prefers an explicit handshake token', () => {
    assert.equal(handshakeToken(sock({ origin: 'https://evil.test', cookie: 'asteai_at=jwt' }, { token: 't' }), origins), 't');
  });
});
