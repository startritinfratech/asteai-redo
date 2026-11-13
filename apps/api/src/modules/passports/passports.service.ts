import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { mapPassportRow, PassportRow } from './passport.mapper';
import { UpdateShareDto } from './dto/update-share.dto';

const PASSPORT_VALIDITY_MS = 730 * 86_400_000; // 2 years

@Injectable()
export class PassportsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findForUser(userId: string) {
    const { rows } = await this.db.query<PassportRow>(
      `SELECT * FROM passports WHERE user_id = $1 ORDER BY issued_at DESC`,
      [userId],
    );
    return rows.map(mapPassportRow);
  }

  private async load(id: string): Promise<PassportRow> {
    const { rows } = await this.db.query<PassportRow>(`SELECT * FROM passports WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Passport ${id} not found`);
    return rows[0];
  }

  /** Its holder and admins always; anyone else only when the holder made it discoverable. */
  async findById(id: string, user: User) {
    const row = await this.load(id);
    if (row.user_id !== user.id && user.role !== 'Admin' && !row.discoverable) {
      throw new NotFoundException(`Passport ${id} not found`);
    }
    return mapPassportRow(row);
  }

  /** Issue / reissue a passport after an assessment result is sealed. */
  async issue(userId: string, data: {
    name: string; tier: string; scores: [string, number][];
    stenIq: number; stenEq: number; stenGrit: number; percentile: number;
  }) {
    const id = generateId('PASS');
    const validUntil = new Date(Date.now() + PASSPORT_VALIDITY_MS);
    const hash = createHash('sha256').update(JSON.stringify({ id, ...data })).digest('hex').slice(0, 16);

    return withTransaction(this.db, async (client) => {
      // Revoke any existing valid passport for this user + tier.
      await client.query(
        `UPDATE passports SET status = 'Revoked', updated_at = NOW()
          WHERE user_id = $1 AND tier = $2 AND status = 'Valid'`,
        [userId, data.tier],
      );
      const { rows } = await client.query<PassportRow>(
        `INSERT INTO passports
           (id, user_id, name, tier, scores, sten_iq, sten_eq, sten_grit,
            percentile, hash, valid_until, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9,$10,$11,'Valid')
         RETURNING *`,
        [
          id, userId, data.name, data.tier, JSON.stringify(data.scores),
          data.stenIq, data.stenEq, data.stenGrit, data.percentile, hash, validUntil,
        ],
      );
      return mapPassportRow(rows[0]);
    });
  }

  async verify(hash: string) {
    if (!hash) return { valid: false, message: 'Passport not found' };
    const { rows } = await this.db.query<PassportRow>(
      `SELECT p.*, CONCAT_WS(' ', u.first_name, u.last_name) AS holder_name
         FROM passports p
         JOIN user_accounts u ON p.user_id = u.id
        WHERE p.hash = $1`,
      [hash],
    );
    if (!rows.length) return { valid: false, message: 'Passport not found' };
    const p = rows[0];
    if (p.status !== 'Valid') return { valid: false, message: `Passport is ${p.status}` };
    if (p.valid_until && new Date(p.valid_until) < new Date()) return { valid: false, message: 'Passport expired' };

    const passport = mapPassportRow(p);
    // Respect the holder's identity setting.
    if (!p.show_identity) delete passport.holderName;
    return { valid: true, passport };
  }

  async updateShare(id: string, share: UpdateShareDto, user: User) {
    const { rows } = await this.db.query<PassportRow>(
      `UPDATE passports SET discoverable = $1, show_identity = $2, updated_at = NOW()
        WHERE id = $3 AND user_id = $4 RETURNING *`,
      [share.discoverable, share.showIdentity, id, user.id],
    );
    if (!rows.length) throw new NotFoundException(`Passport ${id} not found`);
    return mapPassportRow(rows[0]);
  }

  /** An employer or admin records that they checked this passport. Atomic append. */
  async addVerification(id: string, user: User) {
    const row = await this.load(id);
    if (row.user_id === user.id) throw new ForbiddenException('You cannot verify your own passport');
    const entry = JSON.stringify([{ t: Date.now(), by: `${user.firstName} ${user.lastName}`.trim() }]);
    const { rows } = await this.db.query<PassportRow>(
      `UPDATE passports SET verifications = verifications || $1::jsonb, updated_at = NOW()
        WHERE id = $2 RETURNING *`,
      [entry, id],
    );
    return mapPassportRow(rows[0]);
  }
}
