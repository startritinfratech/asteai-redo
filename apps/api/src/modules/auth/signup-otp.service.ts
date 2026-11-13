import { BadRequestException, HttpException, HttpStatus, Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHmac, randomInt, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import type { SendOtpResult, VerifyOtpResult } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { BotCheckService } from '../../common/security/bot-check.service';
import { EmailService } from '../email/email.service';

export const OTP_TTL_MS = 10 * 60_000;
export const OTP_MAX_ATTEMPTS = 5;
export const OTP_RESEND_AFTER_S = 60;
export const OTP_TICKET_TTL_S = 15 * 60;

/** Claims of the ticket POST /auth/register accepts. `purpose` keeps JwtStrategy from ever taking it as a login. */
interface SignupTicket { email: string; purpose: 'signup' }

const INVALID = 'That code is incorrect or has expired. Request a new one.';

/**
 * Email one-time codes for sign-up:
 *  send   → bot check, 60 s cooldown per address, older codes retired, a 6-digit code emailed.
 *           An address that already has an account gets a "sign in instead" email and the
 *           same response, so the endpoint does not reveal who is registered.
 *  verify → at most 5 attempts per code, 10-minute lifetime, constant-time compare; success
 *           consumes the code and returns a 15-minute signed ticket for POST /auth/register.
 */
@Injectable()
export class SignupOtpService {
  private readonly pepper: string;
  private readonly ticketSecret: string;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly email: EmailService,
    private readonly bots: BotCheckService,
    private readonly jwt: JwtService,
    config: ConfigService,
  ) {
    const secret = config.getOrThrow<string>('JWT_SECRET');
    this.pepper = `${secret}:signup-otp-code`;
    this.ticketSecret = `${secret}:signup-otp-ticket`;
  }

  /** HMAC of the code keyed with the server secret and bound to the row, so a DB leak alone can't be brute-forced offline cheaply. */
  hashCode(rowId: string, code: string): string {
    return createHmac('sha256', this.pepper).update(`${rowId}:${code}`).digest('hex');
  }

  async send(rawEmail: string, bot: { website?: string; turnstileToken?: string }, ip: string | null): Promise<SendOtpResult> {
    const email = rawEmail.trim().toLowerCase();
    const result: SendOtpResult = { sent: true, resendAfter: OTP_RESEND_AFTER_S };
    if ((await this.bots.check({ ...bot, email }, ip)) === 'drop') return result;

    await withTransaction(this.db, async (client) => {
      // Serialise concurrent sends for one address so the cooldown can't be raced.
      await client.query(`SELECT pg_advisory_xact_lock(hashtext('signup-otp:' || $1))`, [email]);
      const recent = await client.query(
        `SELECT 1 FROM email_otps WHERE LOWER(email) = $1 AND purpose = 'register'
            AND created_at > NOW() - make_interval(secs => $2)`,
        [email, OTP_RESEND_AFTER_S],
      );
      if (recent.rowCount) {
        throw new HttpException(`Please wait ${OTP_RESEND_AFTER_S} seconds before requesting another code.`, HttpStatus.TOO_MANY_REQUESTS);
      }

      await client.query(
        `UPDATE email_otps SET consumed_at = NOW() WHERE LOWER(email) = $1 AND purpose = 'register' AND consumed_at IS NULL`,
        [email],
      );

      const exists = await client.query(
        `SELECT 1 FROM user_accounts WHERE email_canonical = $1 OR LOWER(email) = $1`, [email],
      );
      // Record the request either way so the cooldown also covers registered addresses.
      const code = String(randomInt(0, 1_000_000)).padStart(6, '0');
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO email_otps (email, purpose, code_hash, expires_at, ip, consumed_at)
         VALUES ($1, 'register', 'pending', $2, $3, CASE WHEN $4 THEN NOW() END) RETURNING id`,
        [email, new Date(Date.now() + OTP_TTL_MS), ip, Boolean(exists.rowCount)],
      );
      await client.query(`UPDATE email_otps SET code_hash = $2 WHERE id = $1`, [rows[0].id, this.hashCode(rows[0].id, code)]);

      if (exists.rowCount) {
        await this.email.enqueue('signup-account-exists', email, {}, { client });
      } else {
        await this.email.enqueue('signup-otp', email, { code, expiresInMinutes: OTP_TTL_MS / 60_000 }, { client });
      }
    });
    return result;
  }

  async verify(rawEmail: string, code: string): Promise<VerifyOtpResult> {
    const email = rawEmail.trim().toLowerCase();
    if (!/^\d{6}$/.test(code)) throw new BadRequestException(INVALID);

    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{ id: string; code_hash: string; attempts: number; expires_at: Date }>(
        `SELECT id, code_hash, attempts, expires_at FROM email_otps
          WHERE LOWER(email) = $1 AND purpose = 'register' AND consumed_at IS NULL
          ORDER BY created_at DESC LIMIT 1 FOR UPDATE`,
        [email],
      );
      const otp = rows[0];
      if (!otp || otp.expires_at <= new Date() || otp.attempts >= OTP_MAX_ATTEMPTS) throw new BadRequestException(INVALID);

      const expected = Buffer.from(otp.code_hash, 'hex');
      const actual = Buffer.from(this.hashCode(otp.id, code), 'hex');
      if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
        // Counted outside the failing transaction: commit the increment, then report the failure.
        await client.query(`UPDATE email_otps SET attempts = attempts + 1 WHERE id = $1`, [otp.id]);
        return null;
      }
      await client.query(`UPDATE email_otps SET consumed_at = NOW() WHERE id = $1`, [otp.id]);
      const claims: SignupTicket = { email, purpose: 'signup' };
      return {
        otpTicket: this.jwt.sign(claims, { secret: this.ticketSecret, expiresIn: OTP_TICKET_TTL_S }),
        expiresIn: OTP_TICKET_TTL_S,
      };
    }).then((r) => {
      if (!r) throw new BadRequestException(INVALID);
      return r;
    });
  }

  /** The verified address a ticket carries, or null when it is invalid, expired or not a sign-up ticket. */
  ticketEmail(ticket: string): string | null {
    try {
      const claims = this.jwt.verify<SignupTicket>(ticket, { secret: this.ticketSecret });
      return claims.purpose === 'signup' && typeof claims.email === 'string' ? claims.email : null;
    } catch {
      return null;
    }
  }
}
