import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import type { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import type { JwtService } from '@nestjs/jwt';
import type { User } from '@asteai/types';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { isBlocked } from './account-status';
import type { TwoFactorService } from './two-factor.service';
import type { EmailService } from '../email/email.service';

/** A pool that answers queries in order from `replies` and records the SQL it saw. */
function fakePool(replies: { rows: unknown[] }[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      sql.push(text);
      params.push(values);
      const next = replies.shift() ?? { rows: [] };
      return { rowCount: next.rows.length, ...next };
    },
  } as unknown as Pool;
  return { pool, sql, params };
}

const svcFor = (pool: Pool) => new AuthService(pool, {} as JwtService, {} as ConfigService, {} as EmailService);
const controllerFor = (pool: Pool) => new AuthController(svcFor(pool), {} as TwoFactorService, {} as never);

describe('isBlocked', () => {
  const base = { is_banned: false, is_suspended: false, suspended_until: null };
  it('blocks banned and currently suspended accounts only', () => {
    assert.equal(isBlocked(base), false);
    assert.equal(isBlocked({ ...base, is_banned: true }), true);
    assert.equal(isBlocked({ ...base, is_suspended: true }), true, 'no end date: suspended until lifted');
    assert.equal(isBlocked({ ...base, is_suspended: true, suspended_until: new Date(Date.now() + 60_000) }), true);
    assert.equal(isBlocked({ ...base, is_suspended: true, suspended_until: new Date(Date.now() - 60_000) }), false);
  });
});

describe('AuthService.validateUser', () => {
  it('refuses a banned account with 403 once the password is right', async () => {
    const hash = await bcrypt.hash('correct horse', 4);
    const row = { id: 'u1', email: 'a@example.test', password_hash: hash, is_banned: true, is_suspended: false, suspended_until: null };
    await assert.rejects(svcFor(fakePool([{ rows: [row] }]).pool).validateUser('a@example.test', 'correct horse'), ForbiddenException);
    assert.equal(await svcFor(fakePool([{ rows: [row] }]).pool).validateUser('a@example.test', 'wrong'), null);
  });
});

describe('AuthController.logout', () => {
  it('revokes all tokens for an authenticated user', async () => {
    const { pool, sql, params } = fakePool([]);
    await controllerFor(pool).logout({ id: 'u1' } as User, {});
    assert.match(sql[0], /WHERE user_id = \$1 AND revoked = FALSE/);
    assert.deepEqual(params[0], ['u1']);
  });

  it('revokes just the given refresh token without an access token', async () => {
    const hash = await bcrypt.hash('secret', 4);
    const { pool, sql, params } = fakePool([{ rows: [{ token_hash: hash }] }]);
    await controllerFor(pool).logout(null, { userId: 'u1', refreshToken: 'tok-1.secret' });
    assert.deepEqual(params[0], ['tok-1', 'u1']);
    assert.match(sql[1], /UPDATE refresh_tokens SET revoked = TRUE WHERE id::text = \$1/);
    assert.deepEqual(params[1], ['tok-1']);
  });

  it('ignores a wrong refresh token secret', async () => {
    const hash = await bcrypt.hash('secret', 4);
    const { pool, sql } = fakePool([{ rows: [{ token_hash: hash }] }]);
    await controllerFor(pool).logout(null, { userId: 'u1', refreshToken: 'tok-1.guess' });
    assert.equal(sql.length, 1);
  });

  it('answers 401 with neither an access token nor a refresh token', async () => {
    await assert.rejects(controllerFor(fakePool([]).pool).logout(null, {}), UnauthorizedException);
  });
});
