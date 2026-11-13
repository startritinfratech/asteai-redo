import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable,
  InternalServerErrorException, Logger, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { Pool, PoolClient } from 'pg';
import type {
  TwoFactorChallengeResponse, TwoFactorEnableResponse, TwoFactorSetupResponse, TwoFactorStatus, User,
} from '@asteai/types';
import { BACKUP_CODE_COUNT } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { EmailService } from '../email/email.service';
import { mapUserRow, USER_COLUMNS, UserRow } from '../users/user.mapper';
import { ACCOUNT_ACTIVE_SQL, BlockColumns, isBlocked } from './account-status';
import { AuthService, AuthTokens, SessionMeta } from './auth.service';
import {
  base32Encode, deriveKey, generateBackupCode, generateTotpSecret, normalizeBackupCode, otpauthUri, seal,
  sha256Hex, unseal, verifyTotp,
} from './totp';

export const MAX_FAILED_ATTEMPTS = 5;
export const LOCKOUT_MINUTES = 15;
export { BACKUP_CODE_COUNT };
const CHALLENGE_TTL = '5m';
const CHALLENGE_PURPOSE = '2fa';

export interface SecondFactor {
  code?: string;
  backupCode?: string;
}

interface TotpRow {
  secret_encrypted: string;
  enabled: boolean;
  last_used_step: string | number | null;
  locked: boolean;
}

/**
 * TOTP two-factor authentication: enrolment, backup codes, and the second login step.
 *
 * When 2FA is on, a correct password does not yield tokens; it yields a challenge: a
 * JWT signed with a key derived from JWT_SECRET for this purpose only (so it can never
 * pass as an access token, which JwtStrategy also refuses by its `purpose` claim), valid
 * for 5 minutes. POST /auth/login/2fa trades the challenge plus a code for tokens.
 *
 * Every wrong code (login, enable, disable) counts towards a lockout of 15 minutes after
 * 5 failures. A code's time step is recorded when it is accepted, so the same code (or
 * an older one) cannot be used again.
 */
@Injectable()
export class TwoFactorService {
  private readonly logger = new Logger(TwoFactorService.name);
  private warnedDevKey = false;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly auth: AuthService,
    private readonly email: EmailService,
  ) {}

  // ── Keys ─────────────────────────────────────────────────────────────────────

  /** AES-256-GCM key for TOTP secrets: from TOTP_ENCRYPTION_KEY, or JWT_SECRET in development. */
  private totpKey(): Buffer {
    const configured = this.config.get<string>('TOTP_ENCRYPTION_KEY');
    if (configured) return deriveKey(configured, 'totp-secret-v1');
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new InternalServerErrorException('Two-factor authentication is not configured');
    }
    if (!this.warnedDevKey) {
      this.warnedDevKey = true;
      this.logger.warn('TOTP_ENCRYPTION_KEY is not set: deriving the TOTP key from JWT_SECRET (development only)');
    }
    return deriveKey(this.config.getOrThrow<string>('JWT_SECRET'), 'totp-secret-dev-v1');
  }

  private challengeSecret(): string {
    return deriveKey(this.config.getOrThrow<string>('JWT_SECRET'), 'login-2fa-challenge-v1').toString('hex');
  }

  // ── Status and enrolment ─────────────────────────────────────────────────────

  async status(userId: string): Promise<TwoFactorStatus> {
    const { rows } = await this.db.query<{ enabled: boolean; enrolled_at: Date | null; remaining: string | number }>(
      `SELECT t.enabled, t.enrolled_at,
              (SELECT COUNT(*) FROM user_totp_backup_codes b WHERE b.user_id = t.user_id AND b.used_at IS NULL) AS remaining
         FROM user_totp t WHERE t.user_id = $1`,
      [userId],
    );
    const row = rows[0];
    if (!row?.enabled) return { enabled: false, enrolledAt: null, backupCodesRemaining: 0 };
    return {
      enabled: true,
      enrolledAt: row.enrolled_at ? new Date(row.enrolled_at).toISOString() : null,
      backupCodesRemaining: Number(row.remaining),
    };
  }

  /** Starts (or restarts) enrolment with a new secret. Nothing changes for login until enable(). */
  async setup(user: User): Promise<TwoFactorSetupResponse> {
    const secret = generateTotpSecret();
    const { rows } = await this.db.query(
      `INSERT INTO user_totp (user_id, secret_encrypted, enabled)
       VALUES ($1, $2, FALSE)
       ON CONFLICT (user_id) DO UPDATE
         SET secret_encrypted = EXCLUDED.secret_encrypted, enabled = FALSE, enrolled_at = NULL,
             last_used_step = NULL, failed_attempts = 0, locked_until = NULL
       WHERE user_totp.enabled = FALSE
       RETURNING user_id`,
      [user.id, seal(secret, this.totpKey())],
    );
    if (!rows.length) throw new ConflictException('Two-factor authentication is already on');
    return { secret: base32Encode(secret), otpauthUri: otpauthUri(secret, user.email) };
  }

  /** Confirms enrolment with a code from the app; returns the backup codes, once. */
  async enable(user: User, code: string): Promise<TwoFactorEnableResponse> {
    await this.verifySecondFactor(user.id, { code }, { enrolling: true, wrong: ForbiddenException });
    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);
    await withTransaction(this.db, async (client) => {
      const updated = await client.query(
        `UPDATE user_totp SET enabled = TRUE, enrolled_at = NOW() WHERE user_id = $1 AND enabled = FALSE`,
        [user.id],
      );
      if (!updated.rowCount) throw new ConflictException('Two-factor authentication is already on');
      await this.replaceBackupCodes(client, user.id, backupCodes);
      await client.query(`UPDATE user_accounts SET two_factor_enabled = TRUE, updated_at = NOW() WHERE id = $1`, [user.id]);
      await this.email.enqueue('two-factor-enabled', user.email, { firstName: user.firstName }, { client, userId: user.id });
    });
    return { backupCodes };
  }

  /** Turns 2FA off; needs the password and a current code (or a backup code). */
  async disable(user: User, password: string, factor: SecondFactor): Promise<void> {
    await this.checkPassword(user.id, password);
    await this.verifySecondFactor(user.id, factor, { wrong: ForbiddenException });
    await withTransaction(this.db, async (client) => {
      await client.query(`DELETE FROM user_totp_backup_codes WHERE user_id = $1`, [user.id]);
      await client.query(`DELETE FROM user_totp WHERE user_id = $1`, [user.id]);
      await client.query(`UPDATE user_accounts SET two_factor_enabled = FALSE, updated_at = NOW() WHERE id = $1`, [user.id]);
    });
  }

  // ── Login ────────────────────────────────────────────────────────────────────

  /** After a correct password: tokens, or a challenge when 2FA is on. */
  async startLogin(user: User, meta: SessionMeta = {}): Promise<AuthTokens | TwoFactorChallengeResponse> {
    const { rows } = await this.db.query(`SELECT 1 FROM user_totp WHERE user_id = $1 AND enabled = TRUE`, [user.id]);
    if (!rows.length) return this.auth.login(user, meta);
    const challenge = this.jwt.sign(
      { purpose: CHALLENGE_PURPOSE, uid: user.id },
      { secret: this.challengeSecret(), expiresIn: CHALLENGE_TTL },
    );
    return { twoFactorRequired: true, challenge };
  }

  async completeLogin(challenge: string, factor: SecondFactor, meta: SessionMeta = {}): Promise<AuthTokens> {
    let payload: { purpose?: unknown; uid?: unknown };
    try {
      payload = this.jwt.verify(challenge, { secret: this.challengeSecret() });
    } catch {
      throw new UnauthorizedException('Your sign-in has expired. Enter your email and password again.');
    }
    if (payload.purpose !== CHALLENGE_PURPOSE || typeof payload.uid !== 'string') throw new UnauthorizedException();

    const { rows } = await this.db.query<UserRow & BlockColumns>(
      `SELECT ${USER_COLUMNS}, is_banned, is_suspended, suspended_until
         FROM user_accounts WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL}`,
      [payload.uid],
    );
    if (!rows.length) throw new UnauthorizedException();
    await this.verifySecondFactor(payload.uid, factor, { wrong: UnauthorizedException });
    if (isBlocked(rows[0])) throw new ForbiddenException('This account is suspended');
    return this.auth.login(mapUserRow(rows[0]), meta);
  }

  // ── Checks ───────────────────────────────────────────────────────────────────

  private async checkPassword(userId: string, password: string): Promise<void> {
    const { rows } = await this.db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM user_accounts WHERE id = $1`,
      [userId],
    );
    // 403, not 401: the web client treats a 401 as an expired session.
    if (!rows[0]?.password_hash || !(await bcrypt.compare(password, rows[0].password_hash))) {
      throw new ForbiddenException('Incorrect password');
    }
  }

  /**
   * Accepts a TOTP code (whose time step must be newer than the last accepted one) or an
   * unused backup code. Wrong answers count towards the lockout.
   */
  async verifySecondFactor(
    userId: string,
    factor: SecondFactor,
    opts: { enrolling?: boolean; wrong: new (message: string) => HttpException },
  ): Promise<void> {
    const { rows } = await this.db.query<TotpRow>(
      `SELECT secret_encrypted, enabled, last_used_step, (locked_until IS NOT NULL AND locked_until > NOW()) AS locked
         FROM user_totp WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    const enrolling = opts.enrolling ?? false;
    if (!row || row.enabled === enrolling) {
      throw new BadRequestException(enrolling ? 'Start two-factor setup first' : 'Two-factor authentication is not on');
    }
    if (row.locked) throw tooManyAttempts();

    if (factor.code) {
      const step = verifyTotp(unseal(row.secret_encrypted, this.totpKey()), factor.code);
      const last = row.last_used_step === null ? null : Number(row.last_used_step);
      if (step !== null && (last === null || step > last)) {
        const accepted = await this.db.query(
          `UPDATE user_totp SET last_used_step = $2, failed_attempts = 0, locked_until = NULL
            WHERE user_id = $1 AND (last_used_step IS NULL OR last_used_step < $2)`,
          [userId, step],
        );
        if (accepted.rowCount) return;
      }
    } else if (factor.backupCode && !enrolling) {
      const used = await this.db.query(
        `UPDATE user_totp_backup_codes SET used_at = NOW()
          WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL RETURNING id`,
        [userId, sha256Hex(normalizeBackupCode(factor.backupCode))],
      );
      if (used.rowCount) {
        await this.db.query(`UPDATE user_totp SET failed_attempts = 0, locked_until = NULL WHERE user_id = $1`, [userId]);
        return;
      }
    } else {
      throw new BadRequestException('Enter the code from your authenticator app');
    }

    const { rows: after } = await this.db.query<{ locked: boolean }>(
      `UPDATE user_totp SET
         locked_until    = CASE WHEN failed_attempts + 1 >= $2 THEN NOW() + make_interval(mins => $3) ELSE locked_until END,
         failed_attempts = CASE WHEN failed_attempts + 1 >= $2 THEN 0 ELSE failed_attempts + 1 END
       WHERE user_id = $1
       RETURNING (locked_until IS NOT NULL AND locked_until > NOW()) AS locked`,
      [userId, MAX_FAILED_ATTEMPTS, LOCKOUT_MINUTES],
    );
    if (after[0]?.locked) throw tooManyAttempts();
    throw new opts.wrong('That code is incorrect or has already been used');
  }

  private async replaceBackupCodes(client: PoolClient, userId: string, codes: string[]): Promise<void> {
    await client.query(`DELETE FROM user_totp_backup_codes WHERE user_id = $1`, [userId]);
    await client.query(
      `INSERT INTO user_totp_backup_codes (user_id, code_hash) SELECT $1, UNNEST($2::text[])`,
      [userId, codes.map((c) => sha256Hex(normalizeBackupCode(c)))],
    );
  }
}

function tooManyAttempts(): HttpException {
  return new HttpException(
    `Too many incorrect codes. Try again in ${LOCKOUT_MINUTES} minutes.`,
    HttpStatus.TOO_MANY_REQUESTS,
  );
}
