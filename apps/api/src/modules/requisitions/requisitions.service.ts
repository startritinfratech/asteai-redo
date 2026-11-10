import { ConflictException, Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Pool, type QueryResultRow } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { assertTenantAccess } from '../../common/utils/access';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { UpdateRequisitionDto } from './dto/update-requisition.dto';
import { ReqStatus, Requisition, User } from '@asteai/types';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';

/**
 * Status moves an owner may make. Closed and Filled are final for everyone but admins,
 * who may make any change.
 */
export const REQ_STATUS_MOVES: Record<ReqStatus, readonly ReqStatus[]> = {
  Draft: ['Open', 'Closed'],
  Open: ['Paused', 'Closed', 'Filled'],
  Paused: ['Open', 'Closed', 'Filled'],
  Closed: [],
  Filled: [],
};

export function canMoveRequisition(from: ReqStatus, to: ReqStatus, isAdmin: boolean): boolean {
  if (from === to) return true; // no change
  return isAdmin || REQ_STATUS_MOVES[from].includes(to);
}

@Injectable()
export class RequisitionsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findAll(user: User, filters: Pagination & { status?: ReqStatus }) {
    const { page, pageSize, offset, status } = filters;

    const conditions: string[] = [];
    const values: unknown[] = [];
    let idx = 1;

    // Employers only see their tenant's reqs; Admin sees all
    if (user.role !== 'Admin') {
      if (!user.tenantId) throw new ForbiddenException('No tenant associated');
      conditions.push(`r.tenant_id = $${idx++}`);
      values.push(user.tenantId);
    }

    if (status) {
      conditions.push(`r.status = $${idx++}`);
      values.push(status);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const countQ = await this.db.query(
      `SELECT COUNT(*) FROM requisitions r ${where}`,
      values,
    );
    const total = parseInt(countQ.rows[0].count, 10);

    values.push(pageSize, offset);
    const { rows } = await this.db.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS owner_name
       FROM requisitions r
       JOIN user_accounts u ON r.owner_id = u.id
       ${where}
       ORDER BY r.created_at DESC
       LIMIT $${idx++} OFFSET $${idx++}`,
      values,
    );

    return { data: rows.map((r) => this.mapRow(r)), total, page, pageSize };
  }

  async findOne(id: string, user: User) {
    const { rows } = await this.db.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS owner_name
       FROM requisitions r
       JOIN user_accounts u ON r.owner_id = u.id
       WHERE r.id = $1`,
      [id],
    );
    if (!rows.length) throw new NotFoundException(`Requisition ${id} not found`);
    const req = rows[0];
    assertTenantAccess(user, req.tenant_id);
    return this.mapRow(req);
  }

  async create(dto: CreateRequisitionDto, user: User) {
    if (!user.tenantId) throw new ForbiddenException('No tenant associated');
    const { rows } = await this.db.query(
      `INSERT INTO requisitions
         (id, tenant_id, owner_id, title, industry, func, ech_level, tier,
          weight_iq, weight_eq, weight_grit, language, location, headcount,
          min_shortlist, threshold, stack, brief)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       RETURNING *`,
      [
        generateId('REQ'), user.tenantId, user.id,
        dto.title, dto.industry, dto.func, dto.echLevel, dto.tier,
        dto.weights.iq, dto.weights.eq, dto.weights.grit,
        dto.lang, dto.location, dto.headcount,
        dto.minShortlist ?? 5, dto.threshold ?? 6.0,
        dto.stack ?? [], dto.brief ?? null,
      ],
    );
    return this.mapRow(rows[0]);
  }

  async update(id: string, dto: UpdateRequisitionDto, user: User) {
    const existing = await this.findOne(id, user);
    if (existing.ownerId !== user.id && user.role !== 'Admin') {
      throw new ForbiddenException('Only the owner can edit a requisition');
    }

    if (dto.status && !canMoveRequisition(existing.status, dto.status, user.role === 'Admin')) {
      throw new ConflictException(`Cannot move a requisition from '${existing.status}' to '${dto.status}'`);
    }

    // Every field UpdateRequisitionDto allows; an omitted field keeps its value. The status
    // check is repeated in the WHERE so a concurrent status change isn't overwritten.
    const { rows } = await this.db.query(
      `UPDATE requisitions SET
         title         = COALESCE($1, title),
         industry      = COALESCE($2, industry),
         func          = COALESCE($3, func),
         ech_level     = COALESCE($4, ech_level),
         tier          = COALESCE($5::candidate_tier_enum, tier),
         weight_iq     = COALESCE($6, weight_iq),
         weight_eq     = COALESCE($7, weight_eq),
         weight_grit   = COALESCE($8, weight_grit),
         language      = COALESCE($9, language),
         location      = COALESCE($10, location),
         headcount     = COALESCE($11, headcount),
         min_shortlist = COALESCE($12, min_shortlist),
         threshold     = COALESCE($13, threshold),
         stack         = COALESCE($14::text[], stack),
         brief         = COALESCE($15, brief),
         status        = COALESCE($16::req_status_enum, status),
         updated_at    = NOW()
       WHERE id = $17 AND status = $18
       RETURNING *`,
      [
        dto.title, dto.industry, dto.func, dto.echLevel, dto.tier,
        dto.weights?.iq, dto.weights?.eq, dto.weights?.grit,
        dto.lang, dto.location, dto.headcount, dto.minShortlist, dto.threshold,
        dto.stack, dto.brief, dto.status,
        id, existing.status,
      ],
    );
    if (!rows.length) throw new ConflictException('The requisition changed meanwhile; reload and try again');
    return this.mapRow(rows[0]);
  }

  async fundSla(id: string, user: User) {
    const req = await this.findOne(id, user);
    if (req.sla.funded) return req;
    const { rows } = await this.db.query(
      `UPDATE requisitions SET sla_funded = TRUE, sla_start_at = NOW(), updated_at = NOW()
       WHERE id = $1 RETURNING *`,
      [id],
    );
    return this.mapRow(rows[0]);
  }

  private mapRow(row: QueryResultRow): Requisition {
    const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());
    return {
      id:           row.id,
      tenantId:     row.tenant_id,
      ownerId:      row.owner_id,
      ownerName:    row.owner_name,
      title:        row.title,
      industry:     row.industry,
      func:         row.func,
      echLevel:     row.ech_level,
      tier:         row.tier,
      weights:      { iq: row.weight_iq, eq: row.weight_eq, grit: row.weight_grit },
      lang:         row.language,
      location:     row.location,
      headcount:    row.headcount,
      minShortlist: row.min_shortlist,
      threshold:    row.threshold,
      status:       row.status,
      sla: {
        funded:    Boolean(row.sla_funded),
        start:     iso(row.sla_start_at),
        paused:    iso(row.sla_paused_at),
        delivered: iso(row.sla_delivered_at),
      },
      stack:        row.stack ?? [],
      brief:        row.brief,
      createdAt:    iso(row.created_at) ?? '',
      updatedAt:    iso(row.updated_at) ?? '',
    };
  }
}
