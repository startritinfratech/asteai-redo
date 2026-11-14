import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { PoolBoard, PoolColumn, PoolMember, TalentPoolSummary, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { cleanProspects, DEFAULT_COLUMNS, needsRebalance, normalizeColumns, positionBetween } from './board';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
type Db = Pick<Pool | PoolClient, 'query'>;

interface PoolRow {
  id: string; tenant_id: string; name: string; description: string; columns: PoolColumn[];
  created_at: Date; updated_at: Date; member_count?: number;
}
interface MemberRow {
  id: string; user_id: string | null; email: string; full_name: string; column_key: string; position: number;
  tags: string[]; notes: string; updated_at: Date;
}

const mapPool = (r: PoolRow): TalentPoolSummary => ({
  id: r.id, name: r.name, description: r.description, columns: r.columns, memberCount: Number(r.member_count ?? 0),
  createdAt: new Date(r.created_at).toISOString(), updatedAt: new Date(r.updated_at).toISOString(),
});
const mapMember = (m: MemberRow): PoolMember => ({
  id: m.id, userId: m.user_id, email: m.email, fullName: m.full_name, column: m.column_key, position: Number(m.position),
  tags: m.tags ?? [], notes: m.notes, updatedAt: new Date(m.updated_at).toISOString(),
});

function tenantOf(user: Pick<User, 'tenantId'>): string {
  if (!user.tenantId) throw new ForbiddenException('Talent pools belong to a company account');
  return user.tenantId;
}

/** Talent CRM: per-tenant pools of candidates and prospects on a Kanban board. */
@Injectable()
export class TalentPoolsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async list(user: User): Promise<TalentPoolSummary[]> {
    const { rows } = await this.db.query<PoolRow>(
      `SELECT p.*, (SELECT COUNT(*) FROM talent_pool_members m WHERE m.pool_id = p.id)::int AS member_count
         FROM ats_talent_pools p WHERE p.tenant_id = $1 AND p.archived_at IS NULL ORDER BY p.updated_at DESC`,
      [tenantOf(user)],
    );
    return rows.map(mapPool);
  }

  async create(user: User, input: { name: string; description?: string; columns?: { key?: string; label: string }[] }) {
    const columns = input.columns ? normalizeColumns(input.columns) : DEFAULT_COLUMNS;
    if ('error' in columns) throw new BadRequestException(columns.error);
    const { rows } = await this.db.query<PoolRow>(
      `INSERT INTO ats_talent_pools (tenant_id, name, description, columns, created_by)
       VALUES ($1, $2, $3, $4::jsonb, $5) RETURNING *`,
      [tenantOf(user), input.name.trim(), input.description?.trim() ?? '', JSON.stringify(columns), user.id],
    );
    return mapPool(rows[0]);
  }

  /** The pool, locked when `forUpdate`, after checking it belongs to the caller's company. */
  private async load(db: Db, user: User, id: string, forUpdate = false): Promise<PoolRow> {
    if (!UUID.test(id)) throw new NotFoundException('Pool not found');
    const { rows } = await db.query<PoolRow>(
      `SELECT * FROM ats_talent_pools WHERE id = $1 AND tenant_id = $2 AND archived_at IS NULL ${forUpdate ? 'FOR UPDATE' : ''}`,
      [id, tenantOf(user)],
    );
    if (!rows.length) throw new NotFoundException('Pool not found');
    return rows[0];
  }

  /** Rename / reorder / add / remove columns. A column with cards in it can't be removed. */
  async update(user: User, id: string, input: { name?: string; description?: string; columns?: { key?: string; label: string }[] }) {
    return withTransaction(this.db, async (c) => {
      const pool = await this.load(c, user, id, true);
      let columns = pool.columns;
      if (input.columns) {
        const next = normalizeColumns(input.columns);
        if ('error' in next) throw new BadRequestException(next.error);
        const removed = pool.columns.filter((o) => !next.some((n) => n.key === o.key)).map((o) => o.key);
        if (removed.length) {
          const { rows } = await c.query<{ column_key: string }>(
            `SELECT DISTINCT column_key FROM talent_pool_members WHERE pool_id = $1 AND column_key = ANY($2::text[])`, [id, removed],
          );
          if (rows.length) {
            const names = rows.map((r) => pool.columns.find((o) => o.key === r.column_key)?.label ?? r.column_key);
            throw new ConflictException(`Move the cards out of ${names.join(', ')} before removing it`);
          }
        }
        columns = next;
      }
      const { rows } = await c.query<PoolRow>(
        `UPDATE ats_talent_pools SET name = COALESCE($2, name), description = COALESCE($3, description),
                columns = $4::jsonb, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, input.name?.trim() || null, input.description?.trim() ?? null, JSON.stringify(columns)],
      );
      return mapPool(rows[0]);
    });
  }

  async archive(user: User, id: string) {
    await this.load(this.db, user, id);
    await this.db.query(`UPDATE ats_talent_pools SET archived_at = NOW(), updated_at = NOW() WHERE id = $1`, [id]);
    return { id, archived: true };
  }

  async board(user: User, id: string): Promise<PoolBoard> {
    const pool = await this.load(this.db, user, id);
    const { rows } = await this.db.query<MemberRow>(
      `SELECT * FROM talent_pool_members WHERE pool_id = $1 ORDER BY column_key, position, id`, [id],
    );
    const members = rows.map(mapMember);
    return {
      pool: mapPool({ ...pool, member_count: members.length }),
      columns: pool.columns.map((col) => ({ ...col, members: members.filter((m) => m.column === col.key) })),
    };
  }

  /**
   * Adds up to 500 people to a column (the first by default). Existing members (same
   * email) are left where they are. Platform users are linked by email.
   */
  async addMembers(user: User, id: string, input: { column?: string; members: { email: string; fullName?: string; tags?: string[] }[] }) {
    if (input.members.length > 500) throw new BadRequestException('Add at most 500 people at a time');
    const { valid, invalid } = cleanProspects(input.members);
    return withTransaction(this.db, async (c) => {
      const pool = await this.load(c, user, id, true);
      const column = input.column ?? pool.columns[0].key;
      if (!pool.columns.some((col) => col.key === column)) throw new BadRequestException(`No column "${column}" in this pool`);
      if (!valid.length) return { added: 0, alreadyInPool: 0, invalid };

      const { rows: last } = await c.query<{ max: number | null }>(
        `SELECT MAX(position) AS max FROM talent_pool_members WHERE pool_id = $1 AND column_key = $2`, [id, column],
      );
      let pos = last[0]?.max ?? 0;
      const positions = valid.map(() => (pos = positionBetween(pos, null)));
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO talent_pool_members (pool_id, user_id, email, full_name, column_key, position, tags, added_by)
         SELECT $1, u.id, v.email, v.full_name, $2, v.position, v.tags, $3
           FROM jsonb_to_recordset($4::jsonb) AS v(email text, full_name text, position float8, tags text[])
           LEFT JOIN user_accounts u ON LOWER(u.email) = v.email AND u.deleted_at IS NULL
         ON CONFLICT (pool_id, LOWER(email)) DO NOTHING
         RETURNING id`,
        [id, column, user.id, JSON.stringify(valid.map((v, i) => ({ email: v.email, full_name: v.fullName, position: positions[i], tags: v.tags })))],
      );
      await c.query(`UPDATE ats_talent_pools SET updated_at = NOW() WHERE id = $1`, [id]);
      return { added: rows.length, alreadyInPool: valid.length - rows.length, invalid };
    });
  }

  /**
   * Drag-and-drop: moves a card into `column`, between the cards `beforeId` and `afterId`
   * (either may be omitted for the ends). Renumbers the column if positions ran out.
   */
  async moveMember(user: User, poolId: string, memberId: string, input: { column: string; beforeId?: string; afterId?: string }) {
    return withTransaction(this.db, async (c) => {
      const pool = await this.load(c, user, poolId, true);
      if (!pool.columns.some((col) => col.key === input.column)) throw new BadRequestException(`No column "${input.column}" in this pool`);
      const neighbour = async (nid?: string) => {
        if (!nid) return null;
        const { rows } = await c.query<{ position: number; column_key: string }>(
          `SELECT position, column_key FROM talent_pool_members WHERE id = $1 AND pool_id = $2`, [nid, poolId],
        );
        if (!rows.length || rows[0].column_key !== input.column) throw new BadRequestException('Neighbour cards must be in the target column');
        return Number(rows[0].position);
      };
      let before = await neighbour(input.beforeId);
      let after = await neighbour(input.afterId);
      if (before === null && after === null) {
        const { rows } = await c.query<{ max: number | null }>(
          `SELECT MAX(position) AS max FROM talent_pool_members WHERE pool_id = $1 AND column_key = $2 AND id <> $3`,
          [poolId, input.column, memberId],
        );
        before = rows[0]?.max ?? null;
      }
      if (before !== null && after !== null && after <= before) throw new BadRequestException('beforeId must come before afterId');
      if (needsRebalance(before, after)) {
        await c.query(
          `UPDATE talent_pool_members m SET position = r.n * 1024
             FROM (SELECT id, ROW_NUMBER() OVER (ORDER BY position, id) AS n FROM talent_pool_members
                    WHERE pool_id = $1 AND column_key = $2) r
            WHERE m.id = r.id`,
          [poolId, input.column],
        );
        before = await neighbour(input.beforeId);
        after = await neighbour(input.afterId);
      }
      const { rows } = await c.query<MemberRow>(
        `UPDATE talent_pool_members SET column_key = $3, position = $4, updated_at = NOW()
          WHERE id = $1 AND pool_id = $2 RETURNING *`,
        [memberId, poolId, input.column, positionBetween(before, after)],
      );
      if (!rows.length) throw new NotFoundException('Card not found');
      await c.query(`UPDATE ats_talent_pools SET updated_at = NOW() WHERE id = $1`, [poolId]);
      return mapMember(rows[0]);
    });
  }

  async updateMember(user: User, poolId: string, memberId: string, input: { notes?: string; tags?: string[]; fullName?: string }) {
    await this.load(this.db, user, poolId);
    const tags = input.tags ? [...new Set(input.tags.map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 10) : null;
    const { rows } = await this.db.query<MemberRow>(
      `UPDATE talent_pool_members SET notes = COALESCE($3, notes), tags = COALESCE($4::text[], tags),
              full_name = COALESCE($5, full_name), updated_at = NOW()
        WHERE id = $1 AND pool_id = $2 RETURNING *`,
      [memberId, poolId, input.notes ?? null, tags, input.fullName?.trim() ?? null],
    );
    if (!rows.length) throw new NotFoundException('Card not found');
    return mapMember(rows[0]);
  }

  async removeMember(user: User, poolId: string, memberId: string) {
    await this.load(this.db, user, poolId);
    const { rowCount } = await this.db.query(`DELETE FROM talent_pool_members WHERE id = $1 AND pool_id = $2`, [memberId, poolId]);
    if (!rowCount) throw new NotFoundException('Card not found');
    return { id: memberId, removed: true };
  }

  /** Recipients for an outreach campaign: a pool, optionally only some columns. */
  async recipients(db: Db, user: User, poolId: string, columns?: string[]) {
    const pool = await this.load(db, user, poolId);
    const { rows } = await db.query<{ email: string; full_name: string }>(
      `SELECT email, full_name FROM talent_pool_members
        WHERE pool_id = $1 AND ($2::text[] IS NULL OR column_key = ANY($2::text[]))
        ORDER BY column_key, position`,
      [pool.id, columns?.length ? columns : null],
    );
    return rows.map((r) => ({ email: r.email, fullName: r.full_name }));
  }
}
