import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { mapUserRow, USER_COLUMNS, UserRow } from './user.mapper';

@Injectable()
export class UsersService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findById(id: string): Promise<User> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM user_accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`User ${id} not found`);
    return mapUserRow(rows[0]);
  }

  async updateProfile(id: string, data: UpdateProfileDto): Promise<User> {
    const { rows } = await this.db.query<UserRow>(
      `UPDATE user_accounts SET
         first_name         = COALESCE($1, first_name),
         last_name          = COALESCE($2, last_name),
         title              = COALESCE($3, title),
         avatar_url         = COALESCE($4, avatar_url),
         preferred_language = COALESCE($5, preferred_language),
         updated_at         = NOW()
       WHERE id = $6 AND deleted_at IS NULL
       RETURNING ${USER_COLUMNS}`,
      [data.firstName, data.lastName, data.title, data.avatarUrl, data.lang, id],
    );
    if (!rows.length) throw new NotFoundException(`User ${id} not found`);
    return mapUserRow(rows[0]);
  }

  /**
   * Soft delete: deleted_at + account_status 'deleted', the email replaced by
   * deleted+<id>@invalid, the password and two-factor secrets dropped, and every refresh
   * token revoked (the JWT strategy already refuses deleted accounts). Other records that
   * reference the user are kept.
   */
  async deleteAccount(id: string, password: string): Promise<void> {
    const { rows } = await this.db.query<{ password_hash: string | null }>(
      `SELECT password_hash FROM user_accounts WHERE id = $1 AND deleted_at IS NULL`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`User ${id} not found`);
    if (!rows[0].password_hash) {
      throw new BadRequestException('This account has no password. Set one with "Forgot password" first.');
    }
    // 403, not 401: the web client treats a 401 as an expired session.
    if (!(await bcrypt.compare(password, rows[0].password_hash))) throw new ForbiddenException('Incorrect password');

    await withTransaction(this.db, async (client) => {
      const updated = await client.query(
        `UPDATE user_accounts
            SET deleted_at = NOW(), account_status = 'deleted',
                email = 'deleted+' || id::text || '@invalid', email_canonical = 'deleted+' || id::text || '@invalid',
                password_hash = NULL, two_factor_enabled = FALSE, two_factor_secret = NULL, updated_at = NOW()
          WHERE id = $1 AND deleted_at IS NULL`,
        [id],
      );
      if (!updated.rowCount) throw new NotFoundException(`User ${id} not found`);
      await client.query(`UPDATE refresh_tokens SET revoked = TRUE WHERE user_id = $1 AND revoked = FALSE`, [id]);
      await client.query(`DELETE FROM user_totp_backup_codes WHERE user_id = $1`, [id]);
      await client.query(`DELETE FROM user_totp WHERE user_id = $1`, [id]);
      await client.query(`UPDATE auth_tokens SET used_at = NOW() WHERE user_id = $1 AND used_at IS NULL`, [id]);
    });
  }

  async getConsents(userId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM consents WHERE user_id = $1 ORDER BY created_at ASC`,
      [userId],
    );
    return rows;
  }

  async toggleConsent(userId: string, purpose: string, active: boolean) {
    const status = active ? 'Active' : 'Revoked';
    const revokedAt = active ? null : new Date().toISOString();
    const { rows } = await this.db.query(
      `INSERT INTO consents (user_id, purpose, status, revoked_at)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [userId, purpose, status, revokedAt],
    );
    return rows[0];
  }

  async exportData(userId: string) {
    const [user, consents, apps, passports] = await Promise.all([
      this.findById(userId),
      this.getConsents(userId),
      this.db.query(`SELECT * FROM applications WHERE candidate_id = $1`, [userId]),
      this.db.query(`SELECT * FROM passports WHERE user_id = $1`, [userId]),
    ]);
    return {
      user,
      consents,
      applications: apps.rows,
      passports: passports.rows,
      exportedAt: new Date().toISOString(),
    };
  }
}
