import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, HttpException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { EmailService } from '../email/email.service';
import { fakeBots, fakeConfig, fakeDb, fakeEmail, type Route } from '../../test-support/fakes';
import { AuthService } from './auth.service';
import { OTP_MAX_ATTEMPTS, SignupOtpService } from './signup-otp.service';
import type { RegisterDto } from './dto/register.dto';

const SECRET = 'x'.repeat(40);
const jwt = new JwtService({ secret: SECRET });

function otp(routes: Route[], verdict: Parameters<typeof fakeBots>[0] = 'ok') {
  const db = fakeDb(routes);
  const email = fakeEmail();
  const svc = new SignupOtpService(db.pool, email.svc, fakeBots(verdict).svc, jwt, fakeConfig({ JWT_SECRET: SECRET }));
  return { db, email, svc };
}

describe('SignupOtpService.send', () => {
  it('emails a 6-digit code and stores only its HMAC', async () => {
    const { svc, db, email } = otp([[/INSERT INTO email_otps/, [{ id: 'otp-1' }]]]);
    assert.deepEqual(await svc.send('Jane@X.com ', {}, '1.1.1.1'), { sent: true, resendAfter: 60 });
    const code = (email.queued[0].data as { code: string }).code;
    assert.match(code, /^\d{6}$/);
    assert.equal(email.queued[0].template, 'signup-otp');
    assert.equal(email.queued[0].to, 'jane@x.com');
    const stored = db.all(/UPDATE email_otps SET code_hash/)[0].params[1];
    assert.equal(stored, svc.hashCode('otp-1', code));
    assert.ok(!JSON.stringify(db.log.map((l) => l.params)).includes(`"${code}"`));
  });

  it('answers identically for a registered address but sends "sign in instead" and no code', async () => {
    const { svc, email, db } = otp([
      [/FROM user_accounts/, [{}]],
      [/INSERT INTO email_otps/, [{ id: 'otp-2' }]],
    ]);
    assert.deepEqual(await svc.send('jane@x.com', {}, null), { sent: true, resendAfter: 60 });
    assert.deepEqual(email.queued.map((q) => q.template), ['signup-account-exists']);
    assert.equal(db.all(/INSERT INTO email_otps/)[0].params[3], true, 'stored already consumed');
  });

  it('enforces the resend cooldown with 429', async () => {
    const { svc, email } = otp([[/created_at > NOW\(\) - make_interval/, [{}]]]);
    await assert.rejects(svc.send('jane@x.com', {}, null), (e: HttpException) => e.getStatus() === 429);
    assert.equal(email.queued.length, 0);
  });

  it('honeypot hits get the normal answer and nothing else', async () => {
    const { svc, db } = otp([], 'drop');
    assert.equal((await svc.send('jane@x.com', { website: 'x' }, null)).sent, true);
    assert.equal(db.log.length, 0);
  });
});

describe('SignupOtpService.verify', () => {
  const row = (svc: SignupOtpService, over: Record<string, unknown> = {}) => ({
    id: 'otp-1', code_hash: svc.hashCode('otp-1', '123456'), attempts: 0, expires_at: new Date(Date.now() + 60_000), ...over,
  });

  it('returns a ticket that carries the verified email and consumes the code', async () => {
    const probe = otp([]);
    const { svc, db } = otp([[/FOR UPDATE/, [row(probe.svc)]]]);
    const out = await svc.verify('JANE@x.com', '123456');
    assert.equal(svc.ticketEmail(out.otpTicket), 'jane@x.com');
    assert.equal(db.all(/SET consumed_at = NOW\(\) WHERE id/).length, 1);
  });

  it('counts a wrong code (committed) and rejects it', async () => {
    const probe = otp([]);
    const { svc, db } = otp([[/FOR UPDATE/, [row(probe.svc)]]]);
    await assert.rejects(svc.verify('jane@x.com', '000000'), BadRequestException);
    assert.equal(db.all(/attempts = attempts \+ 1/).length, 1);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('rejects expired codes, exhausted codes, and malformed input without a DB call', async () => {
    const probe = otp([]);
    for (const over of [{ expires_at: new Date(Date.now() - 1) }, { attempts: OTP_MAX_ATTEMPTS }]) {
      const { svc } = otp([[/FOR UPDATE/, [row(probe.svc, over)]]]);
      await assert.rejects(svc.verify('jane@x.com', '123456'), BadRequestException);
    }
    const { svc, db } = otp([]);
    await assert.rejects(svc.verify('jane@x.com', '12ab56'), BadRequestException);
    assert.equal(db.log.length, 0);
  });

  it('only accepts its own tickets (not access tokens, not other secrets)', () => {
    const { svc } = otp([]);
    assert.equal(svc.ticketEmail(jwt.sign({ sub: 'u1', role: 'Admin' })), null);
    assert.equal(svc.ticketEmail(new JwtService({ secret: 'y'.repeat(40) }).sign({ email: 'a@b.c', purpose: 'signup' })), null);
    assert.equal(svc.ticketEmail('garbage'), null);
  });
});

describe('AuthService.register with a sign-up ticket', () => {
  const dto = (over: Partial<RegisterDto> = {}): RegisterDto => ({
    email: 'jane@x.com', firstName: 'Jane', lastName: 'Doe', password: 'long enough pw', role: 'Candidate', ...over,
  });

  function auth(routes: Route[], env: Record<string, string> = {}) {
    const db = fakeDb(routes);
    const email = fakeEmail();
    const signup = new SignupOtpService(db.pool, email.svc as EmailService, fakeBots().svc, jwt, fakeConfig({ JWT_SECRET: SECRET }));
    const svc = new AuthService(db.pool, jwt, fakeConfig({ JWT_REFRESH_EXPIRES_IN: '7d', ...env }), email.svc, signup);
    return { db, email, svc, signup };
  }

  const userRow = { id: 'u1', email: 'jane@x.com', first_name: 'Jane', last_name: 'Doe', role: 'Candidate', tenant_id: null,
    account_status: 'active', email_verified: true, created_at: new Date(), updated_at: new Date() };

  it('creates a verified account and skips the verification email', async () => {
    const { svc, db, email, signup } = auth([
      [/INSERT INTO user_accounts/, [userRow]],
      [/INSERT INTO refresh_tokens/, [{ id: 'rt1' }]],
    ]);
    const ticket = jwt.sign({ email: 'jane@x.com', purpose: 'signup' }, { secret: `${SECRET}:signup-otp-ticket` });
    assert.equal(signup.ticketEmail(ticket), 'jane@x.com');
    await svc.register(dto({ otpTicket: ticket }));
    assert.equal(db.all(/INSERT INTO user_accounts/)[0].params[5], true);
    assert.equal(email.queued.length, 0);
  });

  it('refuses a ticket for a different address', async () => {
    const { svc } = auth([]);
    const ticket = jwt.sign({ email: 'eve@x.com', purpose: 'signup' }, { secret: `${SECRET}:signup-otp-ticket` });
    await assert.rejects(svc.register(dto({ otpTicket: ticket })), BadRequestException);
  });

  it('requires a ticket when SIGNUP_REQUIRE_OTP=true, and keeps the old flow otherwise', async () => {
    await assert.rejects(auth([], { SIGNUP_REQUIRE_OTP: 'true' }).svc.register(dto()), BadRequestException);
    const legacy = auth([[/INSERT INTO user_accounts/, [{ ...userRow, email_verified: false }]], [/INSERT INTO refresh_tokens/, [{ id: 'rt1' }]]]);
    await legacy.svc.register(dto());
    assert.equal(legacy.db.all(/INSERT INTO user_accounts/)[0].params[5], false);
    assert.deepEqual(legacy.email.queued.map((q) => q.template), ['verify-email']);
  });

  it('still reports a taken address as 409', async () => {
    await assert.rejects(auth([]).svc.register(dto()), ConflictException);
  });

});
