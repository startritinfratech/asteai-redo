import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Pool, PoolClient } from 'pg';
import type { SessionInfo, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { EmailService } from '../email/email.service';
import { ACCOUNT_ACTIVE_SQL, BlockColumns, isBlocked } from './account-status';
import { AuthService, AuthTokens, PASSWORD_ROUNDS, SessionMeta } from './auth.service';
import { consumeEmailToken, issueEmailToken, RESET_TOKEN_TTL_MS, VERIFY_TOKEN_TTL_MS } from './email-tokens';

const INVALID_LINK = 'This link is invalid or has expired. Request a new one.';

/**
 * Password reset and change, email verification and the list of signed-in sessions.
 * Reset and verification links carry a single-use token (see email-tokens.ts); the user
 * is always taken from the token's row, never from the request.
 */
@Injectable()
export class AccountSecurityService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly auth: AuthService,
    private readonly email: EmailService,
  ) {}

  // ── Password reset ───────────────────────────────────────────────────────────

  /**
   * Emails a reset link when the address belongs to an active, unblocked account, and
   * does nothing otherwise. The controller answers 204 either way without waiting for
   * this, so neither the response nor its timing reveals whether the account exists.
   */
  async forgotPassword(email: string): Promise<void> {
    const { rows } = await this.db.query<BlockColumns & { id: string; email: string; first_name: string | null }>(
      `SELECT id, email, first_name, is_banned, is_suspended, suspended_until
         FROM user_accounts
        WHERE (email_canonical = LOWER($1) OR LOWER(email) = LOWER($1)) AND ${ACCOUNT_ACTIVE_SQL}`,
      [email.trim()],
    );
    const user = rows[0];
    if (!user || isBlocked(user)) return;
    await withTransaction(this.db, async (client) => {
      const token = await issueEmailToken(client, user.id, 'reset_password', RESET_TOKEN_TTL_MS);
      await this.email.enqueue(
        'password-reset',
        user.email,
        { firstName: user.first_name ?? '', path: `/auth/reset?token=${token}`, expiresInMinutes: RESET_TOKEN_TTL_MS / 60_000 },
        { client, userId: user.id },
      );
    });
  }

  /** Sets a new password from a reset link and signs the account out everywhere. */
  async resetPassword(token: string, password: string): Promise<void> {
    const passwordHash = await bcrypt.hash(password, PASSWORD_ROUNDS);
    await withTransaction(this.db, async (client) => {
      const userId = await consumeEmailToken(client, token, 'reset_password');
      if (!userId) throw new BadRequestException(INVALID_LINK);
      // The link was delivered to the address, so it also proves the address works.
      const { rows } = await client.query<{ email: string; first_name: string | null }>(
        `UPDATE user_accounts
            SET password_hash = $2, password_changed_at = NOW(), email_verified = TRUE, updated_at = NOW()
          WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL}
          RETURNING email, first_name`,
        [userId, passwordHash],
      );
      if (!rows.length) throw new BadRequestException(INVALID_LINK);
      await this.revokeAllSessions(client, userId);
      await this.email.enqueue(
        'password-changed',
        rows[0].email,
        { firstName: rows[0].first_name ?? '', reason: 'reset' },
        { client, userId },
      );
    });
  }

  /**
   * Changes the password after checking the current one. Every refresh token (and, via
   * password_changed_at, every older access token) stops working; this device gets new ones.
   */
  async changePassword(user: User, currentPassword: string, newPassword: string, meta: SessionMeta = {}): Promise<AuthTokens> {
    const { rows } = await this.db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM user_accounts WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL}`,
      [user.id],
    );
    if (!rows.length) throw new NotFoundException();
    // 403, not 401: the web client treats a 401 as an expired session.
    if (!rows[0].password_hash || !(await bcrypt.compare(currentPassword, rows[0].password_hash))) {
      throw new ForbiddenException('Your current password is incorrect');
    }
    const passwordHash = await bcrypt.hash(newPassword, PASSWORD_ROUNDS);
    const changedAt = await withTransaction(this.db, async (client) => {
      const { rows: changed } = await client.query<{ password_changed_at: Date | null }>(
        `UPDATE user_accounts SET password_hash = $2, password_changed_at = NOW(), updated_at = NOW() WHERE id = $1
         RETURNING password_changed_at`,
        [user.id, passwordHash],
      );
      await this.revokeAllSessions(client, user.id);
      await this.email.enqueue('password-changed', user.email, { firstName: user.firstName, reason: 'changed' }, { client, userId: user.id });
      return changed[0]?.password_changed_at ?? null;
    });
    // This device's new access token must postdate the change it just made.
    return this.auth.login(user, meta, changedAt);
  }

  // ── Email verification ───────────────────────────────────────────────────────

  async sendVerification(user: User): Promise<void> {
    if (user.emailVerified) return;
    await withTransaction(this.db, async (client) => {
      const token = await issueEmailToken(client, user.id, 'verify_email', VERIFY_TOKEN_TTL_MS);
      await this.email.enqueue(
        'verify-email',
        user.email,
        { firstName: user.firstName, path: `/auth/verify-email?token=${token}` },
        { client, userId: user.id },
      );
    });
  }

  async verifyEmail(token: string): Promise<void> {
    await withTransaction(this.db, async (client) => {
      const userId = await consumeEmailToken(client, token, 'verify_email');
      if (!userId) throw new BadRequestException(INVALID_LINK);
      const updated = await client.query(
        `UPDATE user_accounts SET email_verified = TRUE, updated_at = NOW() WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL}`,
        [userId],
      );
      if (!updated.rowCount) throw new BadRequestException(INVALID_LINK);
    });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────

  async listSessions(userId: string): Promise<SessionInfo[]> {
    const { rows } = await this.db.query<{
      id: string; session_started_at: Date; created_at: Date; expires_at: Date; user_agent: string | null; ip_address: string | null;
    }>(
      `SELECT id, session_started_at, created_at, expires_at, user_agent, host(ip_address) AS ip_address
         FROM refresh_tokens
        WHERE user_id = $1 AND revoked = FALSE AND expires_at > NOW()
        ORDER BY created_at DESC`,
      [userId],
    );
    return rows.map((r) => ({
      id: r.id,
      createdAt: new Date(r.session_started_at).toISOString(),
      lastUsedAt: new Date(r.created_at).toISOString(),
      expiresAt: new Date(r.expires_at).toISOString(),
      userAgent: r.user_agent,
      ipAddress: r.ip_address,
    }));
  }

  async revokeSession(userId: string, sessionId: string): Promise<void> {
    const { rowCount } = await this.db.query(
      `UPDATE refresh_tokens SET revoked = TRUE WHERE id = $1 AND user_id = $2 AND revoked = FALSE`,
      [sessionId, userId],
    );
    if (!rowCount) throw new NotFoundException('Session not found');
  }

  private async revokeAllSessions(client: PoolClient, userId: string): Promise<void> {
    await client.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`, [userId]);
  }
}
