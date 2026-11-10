import { ConflictException, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import type { AuthTokensResponse, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { EmailService } from '../email/email.service';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { mapUserRow, USER_COLUMNS, UserRow } from '../users/user.mapper';
import { RegisterDto } from './dto/register.dto';
import type { JwtPayload } from './strategies/jwt.strategy';
import { ACCOUNT_ACTIVE_SQL, BlockColumns, isBlocked, NOT_BLOCKED_SQL } from './account-status';
import { issueEmailToken, VERIFY_TOKEN_TTL_MS } from './email-tokens';

/** Tokens + user returned by login, register, refresh and 2FA login (shared with the web app). */
export type AuthTokens = AuthTokensResponse;

/** bcrypt cost for account passwords (register, reset, change). */
export const PASSWORD_ROUNDS = 12;
const REFRESH_TOKEN_ROUNDS = 10;

/** Where a session was started; stored on its refresh tokens and listed by GET /auth/sessions. */
export interface SessionMeta {
  userAgent?: string | null;
  ip?: string | null;
  /** Carried over on refresh, so the session keeps its original sign-in time. */
  sessionStartedAt?: Date | string | null;
}

export function sessionMetaFrom(req: { headers: Record<string, unknown>; ip?: string }): SessionMeta {
  const ua = req.headers['user-agent'];
  return { userAgent: typeof ua === 'string' ? ua.slice(0, 400) : null, ip: req.ip ?? null };
}

@Injectable()
export class AuthService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
    private readonly email: EmailService,
  ) {}

  /**
   * Checks the password. A banned or currently suspended account is refused with 403,
   * but only once the password is right, so the response doesn't reveal account state.
   */
  async validateUser(email: string, password: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow & BlockColumns & { password_hash: string | null }>(
      `SELECT ${USER_COLUMNS}, password_hash, is_banned, is_suspended, suspended_until
         FROM user_accounts
        WHERE (email_canonical = LOWER($1) OR LOWER(email) = LOWER($1)) AND ${ACCOUNT_ACTIVE_SQL}`,
      [email],
    );
    const row = rows[0];
    if (!row?.password_hash) return null;
    const valid = await bcrypt.compare(password, row.password_hash);
    if (!valid) return null;
    if (isBlocked(row)) throw new ForbiddenException('This account is suspended');
    return mapUserRow(row);
  }

  /**
   * Issues an access token and a single-use refresh token.
   * The refresh token is `<row id>.<secret>`: the id finds the row directly, so a
   * refresh costs one bcrypt compare instead of one per outstanding token.
   */
  async login(user: User, meta: SessionMeta = {}): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: user.id, role: user.role, tenantId: user.tenantId };
    const accessToken = this.jwtService.sign(payload);

    const secret = randomBytes(32).toString('base64url');
    const expiresAt = new Date(Date.now() + parseDuration(this.config.get('JWT_REFRESH_EXPIRES_IN', '7d')));
    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO refresh_tokens (user_id, token_hash, expires_at, user_agent, ip_address, session_started_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, NOW())) RETURNING id`,
      [user.id, await bcrypt.hash(secret, REFRESH_TOKEN_ROUNDS), expiresAt, meta.userAgent ?? null, meta.ip ?? null, meta.sessionStartedAt ?? null],
    );
    await this.db.query(`UPDATE user_accounts SET last_login = NOW() WHERE id = $1`, [user.id]);

    return { accessToken, refreshToken: `${rows[0].id}.${secret}`, user };
  }

  /** Creates the account and queues the verification email in the same transaction. */
  async register(dto: RegisterDto, meta: SessionMeta = {}): Promise<AuthTokens> {
    const passwordHash = await bcrypt.hash(dto.password, PASSWORD_ROUNDS);
    try {
      const user = await withTransaction(this.db, async (client) => {
        const { rows } = await client.query<UserRow>(
          `INSERT INTO user_accounts
             (email, email_canonical, first_name, last_name, role, password_hash, auth_provider)
           SELECT $1::text, LOWER($1::text), $2::text, $3::text, $4::user_role_enum, $5::text, 'local'
            WHERE NOT EXISTS (SELECT 1 FROM user_accounts WHERE email_canonical = LOWER($1::text) OR LOWER(email) = LOWER($1::text))
           RETURNING ${USER_COLUMNS}`,
          [dto.email, dto.firstName, dto.lastName, dto.role ?? 'Candidate', passwordHash],
        );
        if (!rows.length) throw new ConflictException('Email already registered');
        const created = mapUserRow(rows[0]);
        const token = await issueEmailToken(client, created.id, 'verify_email', VERIFY_TOKEN_TTL_MS);
        await this.email.enqueue(
          'verify-email',
          created.email,
          { firstName: created.firstName, path: `/auth/verify-email?token=${token}` },
          { client, userId: created.id },
        );
        return created;
      });
      return this.login(user, meta);
    } catch (err) {
      // Two concurrent sign-ups with the same address: the UNIQUE(email) index catches the loser.
      if (isUniqueViolation(err)) throw new ConflictException('Email already registered');
      throw err;
    }
  }

  async refreshTokens(userId: string, rawToken: string): Promise<AuthTokens> {
    const [tokenId, secret] = rawToken.split('.', 2);
    if (!tokenId || !secret) throw new UnauthorizedException('Invalid or expired refresh token');

    const { rows } = await this.db.query<{
      token_hash: string; user_agent: string | null; ip_address: string | null; session_started_at: Date | null;
    }>(
      `SELECT token_hash, user_agent, ip_address, session_started_at FROM refresh_tokens
        WHERE id::text = $1 AND user_id = $2 AND revoked = FALSE AND expires_at > NOW()`,
      [tokenId, userId],
    );
    if (!rows.length || !(await bcrypt.compare(secret, rows[0].token_hash))) {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    // Single use: only the request that flips `revoked` may continue.
    const revoked = await this.db.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE id::text = $1 AND revoked = FALSE`,
      [tokenId],
    );
    if (!revoked.rowCount) throw new UnauthorizedException('Invalid or expired refresh token');

    const { rows: userRows } = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM user_accounts
        WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL} AND ${NOT_BLOCKED_SQL}`,
      [userId],
    );
    if (!userRows.length) throw new UnauthorizedException();
    const prev = rows[0];
    return this.login(mapUserRow(userRows[0]), {
      userAgent: prev.user_agent, ip: prev.ip_address, sessionStartedAt: prev.session_started_at,
    });
  }

  /**
   * Revokes one refresh token, for a logout without a usable access token. Unknown or
   * already revoked tokens are ignored, so logout stays idempotent and reveals nothing.
   */
  async revokeRefreshToken(userId: string, rawToken: string): Promise<void> {
    const [tokenId, secret] = rawToken.split('.', 2);
    if (!tokenId || !secret) return;
    const { rows } = await this.db.query<{ token_hash: string }>(
      `SELECT token_hash FROM refresh_tokens WHERE id::text = $1 AND user_id = $2 AND revoked = FALSE`,
      [tokenId, userId],
    );
    if (!rows.length || !(await bcrypt.compare(secret, rows[0].token_hash))) return;
    await this.db.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE id::text = $1`, [tokenId]);
    await this.db.query(`UPDATE user_accounts SET last_logout = NOW() WHERE id = $1`, [userId]);
  }

  /** Revokes every refresh token of the user (logout with a valid access token). */
  async logout(userId: string): Promise<void> {
    await this.db.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`,
      [userId],
    );
    await this.db.query(`UPDATE user_accounts SET last_logout = NOW() WHERE id = $1`, [userId]);
  }
}

/** Parses durations such as `15m`, `12h`, `7d` (as used by JWT_*_EXPIRES_IN) into milliseconds. */
export function parseDuration(value: string): number {
  const match = /^(\d+)\s*([smhd])$/.exec(value.trim());
  if (!match) throw new Error(`Invalid duration "${value}" (expected e.g. 15m, 12h, 7d)`);
  const unit = { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
  return Number(match[1]) * unit;
}
