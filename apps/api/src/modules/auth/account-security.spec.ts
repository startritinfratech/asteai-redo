import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { HttpException, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import type { User } from '@asteai/types';
import { EmailService } from '../email/email.service';
import { UsersService } from '../users/users.service';
import { AccountController } from './account.controller';
import { AccountSecurityService } from './account-security.service';
import { AuthService, AuthTokens } from './auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import {
  base32Decode, base32Encode, deriveKey, hotp, seal, sha256Hex, totp, unseal, verifyTotp, TotpAlgorithm,
} from './totp';
import { TwoFactorService } from './two-factor.service';

// ── TOTP ───────────────────────────────────────────────────────────────────────

describe('TOTP (RFC 4226 / RFC 6238)', () => {
  it('matches the RFC 4226 HOTP test values', () => {
    const secret = Buffer.from('12345678901234567890');
    const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
    expected.forEach((code, counter) => assert.equal(hotp(secret, counter), code));
  });

  it('matches the RFC 6238 test vectors (8 digits, SHA-1/256/512)', () => {
    const secrets: Record<TotpAlgorithm, Buffer> = {
      sha1: Buffer.from('12345678901234567890'),
      sha256: Buffer.from('12345678901234567890123456789012'),
      sha512: Buffer.from('1234567890123456789012345678901234567890123456789012345678901234'),
    };
    const vectors: [number, string, TotpAlgorithm][] = [
      [59, '94287082', 'sha1'], [59, '46119246', 'sha256'], [59, '90693936', 'sha512'],
      [1111111109, '07081804', 'sha1'], [1111111109, '68084774', 'sha256'], [1111111109, '25091201', 'sha512'],
      [1111111111, '14050471', 'sha1'], [1111111111, '67062674', 'sha256'], [1111111111, '99943326', 'sha512'],
      [1234567890, '89005924', 'sha1'], [1234567890, '91819424', 'sha256'], [1234567890, '93441116', 'sha512'],
      [2000000000, '69279037', 'sha1'], [2000000000, '90698825', 'sha256'], [2000000000, '38618901', 'sha512'],
      [20000000000, '65353130', 'sha1'], [20000000000, '77737706', 'sha256'], [20000000000, '47863826', 'sha512'],
    ];
    for (const [t, code, alg] of vectors) assert.equal(totp(secrets[alg], t * 1000, 8, alg), code, `${alg} @ ${t}`);
  });

  it('accepts the current step ±1 and reports which step matched', () => {
    const secret = Buffer.from('12345678901234567890');
    const now = 1111111111 * 1000;
    const step = Math.floor(1111111111 / 30);
    assert.equal(verifyTotp(secret, totp(secret, now), now), step);
    assert.equal(verifyTotp(secret, totp(secret, now - 30_000), now), step - 1);
    assert.equal(verifyTotp(secret, totp(secret, now + 30_000), now), step + 1);
    assert.equal(verifyTotp(secret, totp(secret, now - 60_000), now), null);
    assert.equal(verifyTotp(secret, totp(secret, now + 60_000), now), null);
    assert.equal(verifyTotp(secret, 'abcdef', now), null);
  });

  it('round-trips base32 and the RFC example secret', () => {
    assert.equal(base32Encode(Buffer.from('12345678901234567890')), 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    assert.equal(base32Decode('gezd gnbv gy3t qojq gezd gnbv gy3t qojq').toString(), '12345678901234567890');
  });

  it('seals secrets with AES-256-GCM and detects tampering or a wrong key', () => {
    const key = deriveKey('k'.repeat(40), 'test');
    const sealed = seal(Buffer.from('secret'), key);
    assert.equal(unseal(sealed, key).toString(), 'secret');
    assert.throws(() => unseal(sealed, deriveKey('other'.repeat(10), 'test')));
    const parts = sealed.split('.');
    parts[3] = Buffer.from('SECRET').toString('base64url');
    assert.throws(() => unseal(parts.join('.'), key));
  });
});

// ── In-memory database ────────────────────────────────────────────────────────

interface UserRec {
  id: string; email: string; email_canonical: string; first_name: string; last_name: string; role: string;
  password_hash: string | null; account_status: string; deleted_at: Date | null; email_verified: boolean;
  is_banned: boolean; is_suspended: boolean; suspended_until: Date | null; password_changed_at: Date | null;
  two_factor_enabled: boolean;
}
interface TokenRec { user_id: string; purpose: string; token_hash: string; expires_at: Date; used_at: Date | null }
interface TotpRec {
  user_id: string; secret_encrypted: string; enabled: boolean; last_used_step: number | null;
  failed_attempts: number; locked_until: Date | null;
}

/**
 * Answers the SQL the account flows send, against in-memory tables, so the tests exercise
 * single use, revocation and lockout as state rather than as canned replies. Unknown SQL
 * throws, so a new query can't silently pass.
 */
class FakeDb {
  users: UserRec[] = [];
  refresh: { id: string; user_id: string; revoked: boolean; token_hash: string }[] = [];
  tokens: TokenRec[] = [];
  totp = new Map<string, TotpRec>();
  backup: { user_id: string; code_hash: string; used_at: Date | null }[] = [];
  outbox: { to: string; template: string; text: string }[] = [];
  readonly pool: Pool;

  constructor() {
    const query = (text: string, params: unknown[] = []) => this.query(text.replace(/\s+/g, ' ').trim(), params);
    this.pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  }

  addUser(over: Partial<UserRec> = {}): UserRec {
    const email = over.email ?? `user${this.users.length}@example.test`;
    const user: UserRec = {
      id: randomUUID(), email, email_canonical: email.toLowerCase(), first_name: 'Asha', last_name: 'Rao', role: 'Candidate',
      password_hash: null, account_status: 'active', deleted_at: null, email_verified: false,
      is_banned: false, is_suspended: false, suspended_until: null, password_changed_at: null, two_factor_enabled: false,
      ...over,
    };
    this.users.push(user);
    return user;
  }

  private userView(u: UserRec) {
    return { ...u, tenant_id: null, title: null, avatar_url: null, preferred_language: 'en', created_at: new Date(), updated_at: new Date() };
  }

  private active = (u: UserRec) => u.account_status === 'active' && !u.deleted_at;

  private async query(sql: string, p: unknown[]): Promise<{ rows: unknown[]; rowCount: number }> {
    const out = (rows: unknown[], rowCount = rows.length) => ({ rows, rowCount });
    const now = Date.now();
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(sql)) return out([]);

    // user_accounts
    if (/^SELECT .* FROM user_accounts WHERE \(email_canonical = LOWER\(\$1\)/.test(sql)) {
      const email = String(p[0]).toLowerCase();
      return out(this.users.filter((u) => (u.email_canonical === email || u.email.toLowerCase() === email) && this.active(u)).map((u) => this.userView(u)));
    }
    if (/^SELECT .* FROM user_accounts WHERE id = \$1 AND account_status = 'active'/.test(sql)) {
      return out(this.users.filter((u) => {
        if (u.id !== p[0] || !this.active(u)) return false;
        if (/to_timestamp\(\$2\)/.test(sql) && u.password_changed_at) {
          return Math.floor(u.password_changed_at.getTime() / 1000) <= Number(p[1]);
        }
        return true;
      }).map((u) => this.userView(u)));
    }
    if (/^SELECT password_hash FROM user_accounts WHERE id = \$1/.test(sql)) {
      return out(this.users.filter((u) => u.id === p[0] && !u.deleted_at).map((u) => ({ password_hash: u.password_hash })));
    }
    if (/^UPDATE user_accounts SET last_login/.test(sql)) return out([]);
    if (/^UPDATE user_accounts SET password_hash = \$2, password_changed_at = NOW\(\), email_verified = TRUE/.test(sql)) {
      const u = this.users.find((x) => x.id === p[0] && this.active(x));
      if (!u) return out([]);
      Object.assign(u, { password_hash: p[1], password_changed_at: new Date(), email_verified: true });
      return out([{ email: u.email, first_name: u.first_name }]);
    }
    if (/^UPDATE user_accounts SET password_hash = \$2, password_changed_at = NOW\(\)/.test(sql)) {
      const u = this.users.find((x) => x.id === p[0])!;
      Object.assign(u, { password_hash: p[1], password_changed_at: new Date() });
      return out([], 1);
    }
    if (/^UPDATE user_accounts SET email_verified = TRUE/.test(sql)) {
      const u = this.users.find((x) => x.id === p[0] && this.active(x));
      if (u) u.email_verified = true;
      return out([], u ? 1 : 0);
    }
    if (/^UPDATE user_accounts SET two_factor_enabled = (TRUE|FALSE)/.test(sql)) {
      this.users.find((x) => x.id === p[0])!.two_factor_enabled = sql.includes('= TRUE');
      return out([], 1);
    }
    if (/^UPDATE user_accounts SET deleted_at = NOW\(\), account_status = 'deleted'/.test(sql)) {
      const u = this.users.find((x) => x.id === p[0] && !x.deleted_at);
      if (!u) return out([]);
      const anon = `deleted+${u.id}@invalid`;
      Object.assign(u, { deleted_at: new Date(), account_status: 'deleted', email: anon, email_canonical: anon, password_hash: null });
      return out([], 1);
    }

    // refresh_tokens
    if (/^INSERT INTO refresh_tokens/.test(sql)) {
      const row = { id: randomUUID(), user_id: String(p[0]), token_hash: String(p[1]), revoked: false };
      this.refresh.push(row);
      return out([{ id: row.id }]);
    }
    if (/^UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = \$1 AND revoked = FALSE$/.test(sql)) {
      const mine = this.refresh.filter((r) => r.user_id === p[0] && !r.revoked);
      mine.forEach((r) => { r.revoked = true; });
      return out([], mine.length);
    }

    // auth_tokens
    if (/^UPDATE auth_tokens SET used_at = NOW\(\) WHERE user_id = \$1 AND purpose = \$2 AND used_at IS NULL$/.test(sql)) {
      this.tokens.filter((t) => t.user_id === p[0] && t.purpose === p[1] && !t.used_at).forEach((t) => { t.used_at = new Date(); });
      return out([]);
    }
    if (/^UPDATE auth_tokens SET used_at = NOW\(\) WHERE user_id = \$1 AND used_at IS NULL$/.test(sql)) {
      this.tokens.filter((t) => t.user_id === p[0] && !t.used_at).forEach((t) => { t.used_at = new Date(); });
      return out([]);
    }
    if (/^INSERT INTO auth_tokens/.test(sql)) {
      this.tokens.push({ user_id: String(p[0]), purpose: String(p[1]), token_hash: String(p[2]), expires_at: p[3] as Date, used_at: null });
      return out([], 1);
    }
    if (/^UPDATE auth_tokens SET used_at = NOW\(\) WHERE token_hash = \$1/.test(sql)) {
      const t = this.tokens.find((x) => x.token_hash === p[0] && x.purpose === p[1] && !x.used_at && x.expires_at.getTime() > now);
      if (!t) return out([]);
      t.used_at = new Date();
      return out([{ user_id: t.user_id }]);
    }

    // email_outbox
    if (/^INSERT INTO email_outbox/.test(sql)) {
      this.outbox.push({ to: String(p[1]), template: String(p[2]), text: String(p[5]) });
      return out([{ id: randomUUID() }]);
    }

    // user_totp
    const locked = (t: TotpRec) => !!t.locked_until && t.locked_until.getTime() > now;
    if (/^INSERT INTO user_totp \(/.test(sql)) {
      const existing = this.totp.get(String(p[0]));
      if (existing?.enabled) return out([]);
      this.totp.set(String(p[0]), {
        user_id: String(p[0]), secret_encrypted: String(p[1]), enabled: false, last_used_step: null, failed_attempts: 0, locked_until: null,
      });
      return out([{ user_id: p[0] }]);
    }
    if (/^SELECT 1 FROM user_totp WHERE user_id = \$1 AND enabled = TRUE/.test(sql)) {
      return out(this.totp.get(String(p[0]))?.enabled ? [{ '?column?': 1 }] : []);
    }
    if (/^SELECT secret_encrypted, enabled, last_used_step/.test(sql)) {
      const t = this.totp.get(String(p[0]));
      return out(t ? [{ ...t, locked: locked(t) }] : []);
    }
    if (/^UPDATE user_totp SET last_used_step = \$2/.test(sql)) {
      const t = this.totp.get(String(p[0]));
      if (!t || (t.last_used_step !== null && t.last_used_step >= Number(p[1]))) return out([]);
      Object.assign(t, { last_used_step: Number(p[1]), failed_attempts: 0, locked_until: null });
      return out([], 1);
    }
    if (/^UPDATE user_totp SET failed_attempts = 0, locked_until = NULL/.test(sql)) {
      Object.assign(this.totp.get(String(p[0]))!, { failed_attempts: 0, locked_until: null });
      return out([], 1);
    }
    if (/^UPDATE user_totp SET locked_until = CASE/.test(sql)) {
      const t = this.totp.get(String(p[0]))!;
      if (t.failed_attempts + 1 >= Number(p[1])) {
        t.locked_until = new Date(now + Number(p[2]) * 60_000);
        t.failed_attempts = 0;
      } else {
        t.failed_attempts += 1;
      }
      return out([{ locked: locked(t) }]);
    }
    if (/^UPDATE user_totp SET enabled = TRUE/.test(sql)) {
      const t = this.totp.get(String(p[0]));
      if (!t || t.enabled) return out([]);
      t.enabled = true;
      return out([], 1);
    }
    if (/^DELETE FROM user_totp WHERE user_id = \$1/.test(sql)) {
      this.totp.delete(String(p[0]));
      return out([]);
    }
    if (/^DELETE FROM user_totp_backup_codes WHERE user_id = \$1/.test(sql)) {
      this.backup = this.backup.filter((b) => b.user_id !== p[0]);
      return out([]);
    }
    if (/^INSERT INTO user_totp_backup_codes/.test(sql)) {
      (p[1] as string[]).forEach((h) => this.backup.push({ user_id: String(p[0]), code_hash: h, used_at: null }));
      return out([]);
    }
    if (/^UPDATE user_totp_backup_codes SET used_at = NOW\(\)/.test(sql)) {
      const b = this.backup.find((x) => x.user_id === p[0] && x.code_hash === p[1] && !x.used_at);
      if (!b) return out([]);
      b.used_at = new Date();
      return out([{ id: 'b' }]);
    }
    throw new Error(`FakeDb: unhandled SQL: ${sql}`);
  }
}

// ── Services wired to the fake ────────────────────────────────────────────────

const JWT_SECRET = 'test-jwt-secret-'.padEnd(48, 'x');
const env: Record<string, string> = { JWT_SECRET, TOTP_ENCRYPTION_KEY: 'test-totp-key-'.padEnd(48, 'y'), NODE_ENV: 'test' };
const config = {
  get: (k: string, d?: string) => env[k] ?? d,
  getOrThrow: (k: string) => {
    if (!(k in env)) throw new Error(`missing ${k}`);
    return env[k];
  },
} as unknown as ConfigService;

function setup() {
  const db = new FakeDb();
  const jwt = new JwtService({ secret: JWT_SECRET, signOptions: { expiresIn: '15m' } });
  const email = new EmailService(db.pool, config);
  const auth = new AuthService(db.pool, jwt, config, email);
  const security = new AccountSecurityService(db.pool, auth, email);
  const twoFactor = new TwoFactorService(db.pool, jwt, config, auth, email);
  const controller = new AccountController(security, twoFactor);
  const strategy = new JwtStrategy(config, db.pool);
  const users = new UsersService(db.pool);
  return { db, jwt, auth, security, twoFactor, controller, strategy, users };
}

const asUser = (u: UserRec): User => ({
  id: u.id, email: u.email, firstName: u.first_name, lastName: u.last_name, role: 'Candidate', tenantId: null,
  accountStatus: 'active', emailVerified: u.email_verified, createdAt: '', updatedAt: '',
});

const linkToken = (text: string) => /token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
const status = (code: number) => (e: unknown) => e instanceof HttpException && e.getStatus() === code;
const flush = () => new Promise((r) => setImmediate(r));

// ── Forgot / reset ────────────────────────────────────────────────────────────

describe('password reset', () => {
  let t: ReturnType<typeof setup>;
  beforeEach(() => { t = setup(); });

  it('forgot answers the same for unknown, blocked and real accounts, and only mails the real one', async () => {
    const real = t.db.addUser({ email: 'Real@Example.test' });
    t.db.addUser({ email: 'banned@example.test', is_banned: true });
    t.db.addUser({ email: 'gone@example.test', account_status: 'deleted', deleted_at: new Date() });

    const answers = ['nobody@example.test', 'banned@example.test', 'gone@example.test', 'real@example.test']
      .map((email) => t.controller.forgotPassword({ email }));
    await flush();
    assert.deepEqual(answers, [undefined, undefined, undefined, undefined]);
    assert.equal(t.db.outbox.length, 1);
    assert.equal(t.db.outbox[0].to, real.email);
    assert.equal(t.db.outbox[0].template, 'password-reset');

    // Only the hash is stored.
    const raw = linkToken(t.db.outbox[0].text);
    assert.match(t.db.outbox[0].text, /\/auth\/reset\?token=/);
    assert.equal(t.db.tokens.length, 1);
    assert.equal(t.db.tokens[0].token_hash, sha256Hex(raw));
    assert.ok(!t.db.tokens.some((x) => x.token_hash === raw));
    assert.ok(t.db.tokens[0].expires_at.getTime() - Date.now() <= 30 * 60_000);
  });

  it('a new request retires the older unused link', async () => {
    t.db.addUser({ email: 'a@example.test' });
    await t.security.forgotPassword('a@example.test');
    await t.security.forgotPassword('a@example.test');
    const [first, second] = t.db.outbox.map((o) => linkToken(o.text));
    await assert.rejects(t.security.resetPassword(first, 'new-password-1'), status(400));
    await t.security.resetPassword(second, 'new-password-1');
  });

  it('reset sets the password, revokes every refresh token, and works once', async () => {
    const u = t.db.addUser({ email: 'a@example.test', password_hash: await bcrypt.hash('old-password', 4) });
    await t.auth.login(asUser(u));
    await t.auth.login(asUser(u));
    assert.equal(t.db.refresh.filter((r) => !r.revoked).length, 2);

    await t.security.forgotPassword('a@example.test');
    const raw = linkToken(t.db.outbox[0].text);
    await t.security.resetPassword(raw, 'brand-new-password');

    assert.ok(await bcrypt.compare('brand-new-password', u.password_hash!));
    assert.ok(u.password_changed_at);
    assert.equal(t.db.refresh.filter((r) => !r.revoked).length, 0);
    assert.ok(t.db.tokens[0].used_at);
    assert.equal(t.db.outbox.at(-1)?.template, 'password-changed');

    await assert.rejects(t.security.resetPassword(raw, 'another-password'), status(400));
    assert.ok(await bcrypt.compare('brand-new-password', u.password_hash!));
  });

  it('refuses an expired link and an unknown one', async () => {
    t.db.addUser({ email: 'a@example.test' });
    await t.security.forgotPassword('a@example.test');
    const raw = linkToken(t.db.outbox[0].text);
    t.db.tokens[0].expires_at = new Date(Date.now() - 1000);
    await assert.rejects(t.security.resetPassword(raw, 'brand-new-password'), status(400));
    await assert.rejects(t.security.resetPassword('x'.repeat(43), 'brand-new-password'), status(400));
  });

  it('access tokens issued before a reset stop working', async () => {
    const u = t.db.addUser({ email: 'a@example.test' });
    const { accessToken } = await t.auth.login(asUser(u));
    const payload = t.jwt.verify(accessToken);
    assert.equal((await t.strategy.validate(payload)).id, u.id);
    u.password_changed_at = new Date(Date.now() + 2000); // a reset after the token was issued
    await assert.rejects(t.strategy.validate(payload), UnauthorizedException);
  });
});

describe('email verification', () => {
  it('verifies with the emailed token once', async () => {
    const t = setup();
    const u = t.db.addUser();
    await t.security.sendVerification(asUser(u));
    const raw = linkToken(t.db.outbox[0].text);
    await t.security.verifyEmail(raw);
    assert.equal(u.email_verified, true);
    await assert.rejects(t.security.verifyEmail(raw), status(400));
  });
});

// ── Two-factor login ──────────────────────────────────────────────────────────

describe('two-factor authentication', () => {
  let t: ReturnType<typeof setup>;
  let u: UserRec;
  let secret: Buffer;
  let backupCodes: string[];

  /** Enrols with the code one step behind now, leaving the current and next steps unused. */
  beforeEach(async () => {
    t = setup();
    u = t.db.addUser({ email: 'twofa@example.test', password_hash: await bcrypt.hash('pass-word-1', 4) });
    const enrol = await t.twoFactor.setup(asUser(u));
    assert.match(enrol.otpauthUri, /^otpauth:\/\/totp\/AsteAI:twofa%40example\.test\?secret=[A-Z2-7]+&issuer=AsteAI/);
    secret = base32Decode(enrol.secret);
    assert.ok(!t.db.totp.get(u.id)!.secret_encrypted.includes(enrol.secret), 'secret stored encrypted');
    ({ backupCodes } = await t.twoFactor.enable(asUser(u), totp(secret, Date.now() - 30_000)));
    assert.equal(backupCodes.length, 10);
    assert.equal(u.two_factor_enabled, true);
    assert.equal(t.db.outbox.at(-1)?.template, 'two-factor-enabled');
  });

  it('login returns a challenge, not tokens, and the challenge is not an access token', async () => {
    const res = await t.twoFactor.startLogin(asUser(u));
    assert.ok('twoFactorRequired' in res && res.twoFactorRequired);
    assert.ok(!('accessToken' in res));
    assert.equal(t.db.refresh.length, 0);
    // Signed with a different key than access tokens…
    assert.throws(() => t.jwt.verify(res.challenge));
    // …and refused by the access-token strategy even if it were not.
    await assert.rejects(t.strategy.validate({ purpose: '2fa', sub: u.id } as never), UnauthorizedException);
  });

  it('a valid code completes login; the same code cannot be used again', async () => {
    const { challenge } = (await t.twoFactor.startLogin(asUser(u))) as { challenge: string };
    const code = totp(secret);
    const tokens: AuthTokens = await t.twoFactor.completeLogin(challenge, { code });
    assert.equal(tokens.user.id, u.id);
    assert.ok(tokens.accessToken && tokens.refreshToken);
    await assert.rejects(t.twoFactor.completeLogin(challenge, { code }), UnauthorizedException);
    // The enrolment code (an older step) is refused too.
    await assert.rejects(t.twoFactor.completeLogin(challenge, { code: totp(secret, Date.now() - 30_000) }), UnauthorizedException);
  });

  it('locks code entry for 15 minutes after 5 wrong codes, even for a right one', async () => {
    const { challenge } = (await t.twoFactor.startLogin(asUser(u))) as { challenge: string };
    const right = totp(secret);
    const wrong = right === '000000' ? '111111' : '000000';
    for (let i = 0; i < 4; i += 1) {
      await assert.rejects(t.twoFactor.completeLogin(challenge, { code: wrong }), UnauthorizedException);
    }
    await assert.rejects(t.twoFactor.completeLogin(challenge, { code: wrong }), status(429));
    await assert.rejects(t.twoFactor.completeLogin(challenge, { code: right }), status(429));
    const lockedFor = t.db.totp.get(u.id)!.locked_until!.getTime() - Date.now();
    assert.ok(lockedFor > 14 * 60_000 && lockedFor <= 15 * 60_000);
    assert.equal(t.db.refresh.length, 0);

    // Once the lock lapses the right code works.
    t.db.totp.get(u.id)!.locked_until = new Date(Date.now() - 1);
    await t.twoFactor.completeLogin(challenge, { code: right });
  });

  it('a backup code works once', async () => {
    const { challenge } = (await t.twoFactor.startLogin(asUser(u))) as { challenge: string };
    await t.twoFactor.completeLogin(challenge, { backupCode: backupCodes[0].toUpperCase() });
    await assert.rejects(t.twoFactor.completeLogin(challenge, { backupCode: backupCodes[0] }), UnauthorizedException);
    assert.ok(!t.db.backup.some((b) => b.code_hash === backupCodes[0]), 'stored hashed');
  });

  it('refuses a forged or expired challenge', async () => {
    const forged = t.jwt.sign({ purpose: '2fa', uid: u.id }); // signed with the access-token key
    await assert.rejects(t.twoFactor.completeLogin(forged, { code: totp(secret) }), UnauthorizedException);
    const challengeKey = deriveKey(JWT_SECRET, 'login-2fa-challenge-v1').toString('hex');
    const expired = t.jwt.sign({ purpose: '2fa', uid: u.id }, { secret: challengeKey, expiresIn: -10 });
    await assert.rejects(t.twoFactor.completeLogin(expired, { code: totp(secret) }), UnauthorizedException);
  });

  it('disable needs the password and a code', async () => {
    await assert.rejects(t.twoFactor.disable(asUser(u), 'wrong-pass', { code: totp(secret) }), status(403));
    await t.twoFactor.disable(asUser(u), 'pass-word-1', { code: totp(secret) });
    assert.equal(u.two_factor_enabled, false);
    const res = await t.twoFactor.startLogin(asUser(u));
    assert.ok('accessToken' in res);
  });
});

// ── Deleted accounts ──────────────────────────────────────────────────────────

describe('account deletion', () => {
  it('a deleted account cannot sign in, refresh or use an old access token', async () => {
    const t = setup();
    const u = t.db.addUser({ email: 'leaving@example.test', password_hash: await bcrypt.hash('pass-word-1', 4) });
    const { accessToken } = await t.auth.login(asUser(u));
    assert.ok(await t.auth.validateUser('leaving@example.test', 'pass-word-1'));

    await assert.rejects(t.users.deleteAccount(u.id, 'wrong'), status(403));
    await t.users.deleteAccount(u.id, 'pass-word-1');

    assert.equal(u.account_status, 'deleted');
    assert.ok(u.deleted_at);
    assert.equal(u.email, `deleted+${u.id}@invalid`);
    assert.equal(t.db.refresh.filter((r) => !r.revoked).length, 0);
    assert.equal(await t.auth.validateUser('leaving@example.test', 'pass-word-1'), null);
    await assert.rejects(t.strategy.validate(t.jwt.verify(accessToken)), UnauthorizedException);
    // Forgot-password for the old address sends nothing.
    await t.security.forgotPassword('leaving@example.test');
    assert.equal(t.db.outbox.length, 0);
  });
});
