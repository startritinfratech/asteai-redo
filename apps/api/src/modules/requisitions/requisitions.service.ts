import { BadRequestException, ConflictException, Injectable, Inject, NotFoundException, ForbiddenException } from '@nestjs/common';
import { EmailService } from '../email/email.service';
import { withTransaction } from '../../database/database.module';
import { approvalAfterEdit, canSubmitForApproval, changedPublicFields, rubricWeightsValid } from './approval';
import { Pool, type QueryResultRow } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { assertTenantAccess } from '../../common/utils/access';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { UpdateRequisitionDto } from './dto/update-requisition.dto';
import { RequisitionPostingDto } from './dto/posting.dto';
import type { ReqApprovalStatus, ReqStatus, Requisition, User } from '@asteai/types';
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
  constructor(@Inject(DB_POOL) private readonly db: Pool, private readonly email: EmailService) {}

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
    if (!rubricWeightsValid(dto.evaluationRubric)) throw new BadRequestException('Rubric weights must be whole numbers adding up to 100');
    const { rows } = await this.db.query(
      `INSERT INTO requisitions
         (id, tenant_id, owner_id, title, industry, func, ech_level, tier,
          weight_iq, weight_eq, weight_grit, language, location, headcount,
          min_shortlist, threshold, stack, brief, screening_questions, evaluation_rubric)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19::jsonb,$20::jsonb)
       RETURNING *`,
      [
        generateId('REQ'), user.tenantId, user.id,
        dto.title, dto.industry, dto.func, dto.echLevel, dto.tier,
        dto.weights.iq, dto.weights.eq, dto.weights.grit,
        dto.lang, dto.location, dto.headcount,
        dto.minShortlist ?? 5, dto.threshold ?? 6.0,
        dto.stack ?? [], dto.brief ?? null,
        JSON.stringify(dto.screeningQuestions ?? []), JSON.stringify(dto.evaluationRubric ?? []),
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
    if (!rubricWeightsValid(dto.evaluationRubric)) throw new BadRequestException('Rubric weights must be whole numbers adding up to 100');
    // Changing what job seekers see on an approved job sends it back for review.
    const approval = approvalAfterEdit(existing.approval?.status ?? 'draft', changedPublicFields(existing, dto).length, false);

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
         screening_questions = COALESCE($19::jsonb, screening_questions),
         evaluation_rubric   = COALESCE($20::jsonb, evaluation_rubric),
         approval_submitted_at = CASE WHEN $21 = 'pending' AND approval_status <> 'pending' THEN NOW() ELSE approval_submitted_at END,
         approval_status = $21,
         updated_at    = NOW()
       WHERE id = $17 AND status = $18
       RETURNING *`,
      [
        dto.title, dto.industry, dto.func, dto.echLevel, dto.tier,
        dto.weights?.iq, dto.weights?.eq, dto.weights?.grit,
        dto.lang, dto.location, dto.headcount, dto.minShortlist, dto.threshold,
        dto.stack, dto.brief, dto.status,
        id, existing.status,
        dto.screeningQuestions ? JSON.stringify(dto.screeningQuestions) : null,
        dto.evaluationRubric ? JSON.stringify(dto.evaluationRubric) : null,
        approval,
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

  /**
   * Public job-board settings. Owner or Admin only. Making it public the first time stamps
   * published_at (the board's sort key); turning it off later keeps that date.
   */
  async updatePosting(id: string, dto: RequisitionPostingDto, user: User) {
    const existing = await this.findOne(id, user);
    if (existing.ownerId !== user.id && user.role !== 'Admin') {
      throw new ForbiddenException('Only the owner can change how a requisition is posted');
    }
    const min = dto.salaryMin !== undefined ? dto.salaryMin : existing.posting?.salaryMin ?? null;
    const max = dto.salaryMax !== undefined ? dto.salaryMax : existing.posting?.salaryMax ?? null;
    if (min !== null && max !== null && min > max) throw new BadRequestException('salaryMin must not exceed salaryMax');
    if (dto.expiresAt && new Date(dto.expiresAt) <= new Date()) throw new BadRequestException('expiresAt must be in the future');

    const set = (key: keyof RequisitionPostingDto) => dto[key] !== undefined;
    // Turning the posting on asks for review; editing an approved posting asks again.
    const approval = approvalAfterEdit(
      existing.approval?.status ?? 'draft', changedPublicFields(existing, dto).length, dto.isPublic === true,
    );
    const { rows } = await this.db.query(
      `UPDATE requisitions SET
         is_public       = COALESCE($2, is_public),
         published_at    = CASE WHEN COALESCE($2, is_public) THEN COALESCE(published_at, NOW()) ELSE published_at END,
         employment_type = COALESCE($3, employment_type),
         location_type   = COALESCE($4, location_type),
         salary_min      = CASE WHEN $5 THEN $6::numeric ELSE salary_min END,
         salary_max      = CASE WHEN $7 THEN $8::numeric ELSE salary_max END,
         salary_currency = COALESCE($9, salary_currency),
         requirements    = COALESCE($10::text[], requirements),
         expires_at      = CASE WHEN $11 THEN $12::timestamptz ELSE expires_at END,
         approval_submitted_at = CASE WHEN $13 = 'pending' AND approval_status <> 'pending' THEN NOW() ELSE approval_submitted_at END,
         approval_status = $13,
         updated_at      = NOW()
       WHERE id = $1
       RETURNING *`,
      [
        id, dto.isPublic ?? null, dto.employmentType ?? null, dto.locationType ?? null,
        set('salaryMin'), dto.salaryMin ?? null, set('salaryMax'), dto.salaryMax ?? null,
        dto.salaryCurrency ?? null, dto.requirements ?? null, set('expiresAt'), dto.expiresAt ?? null,
        approval,
      ],
    );
    return this.mapRow({ ...rows[0], owner_name: existing.ownerName });
  }

  // ── Approval ──────────────────────────────────────────────────────────────

  /** The owner asks for review (draft or rejected → pending). */
  async submitForApproval(id: string, user: User) {
    const existing = await this.findOne(id, user);
    if (existing.ownerId !== user.id && user.role !== 'Admin') {
      throw new ForbiddenException('Only the owner can submit a requisition for review');
    }
    const status = existing.approval?.status ?? 'draft';
    if (!canSubmitForApproval(status)) {
      throw new ConflictException(status === 'pending' ? 'Already waiting for review' : 'Already approved');
    }
    const { rows } = await this.db.query(
      `UPDATE requisitions SET approval_status = 'pending', approval_submitted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND approval_status IN ('draft', 'rejected') RETURNING *`,
      [id],
    );
    if (!rows.length) throw new ConflictException('The requisition changed meanwhile; reload and try again');
    return this.mapRow({ ...rows[0], owner_name: existing.ownerName });
  }

  /** Admin queue: requisitions by approval status, oldest submission first. */
  async approvalQueue(status: ReqApprovalStatus, pagination: Pagination) {
    const { rows } = await this.db.query(
      `SELECT r.*, u.first_name || ' ' || u.last_name AS owner_name, t.name AS tenant_name
         FROM requisitions r
         JOIN user_accounts u ON r.owner_id = u.id
         JOIN tenants t ON t.id = r.tenant_id
        WHERE r.approval_status = $1
        ORDER BY r.approval_submitted_at ASC NULLS LAST, r.created_at ASC
        LIMIT $2 OFFSET $3`,
      [status, pagination.pageSize, pagination.offset],
    );
    return rows.map((r) => ({ ...this.mapRow(r), tenantName: r.tenant_name as string }));
  }

  /**
   * Admin decision on a pending requisition; the owner is emailed in the same
   * transaction. Only an approved requisition can reach the public job board.
   */
  async review(id: string, admin: User, decision: 'approved' | 'rejected', note?: string) {
    if (admin.role !== 'Admin') throw new ForbiddenException();
    if (decision === 'rejected' && !note?.trim()) throw new BadRequestException('Say what needs to change when rejecting');
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query(
        `UPDATE requisitions
            SET approval_status = $2, approval_note = $3, approval_reviewed_by = $4, approval_reviewed_at = NOW(),
                updated_at = NOW()
          WHERE id = $1 AND approval_status = 'pending'
          RETURNING *`,
        [id, decision, note?.trim() || null, admin.id],
      );
      if (!rows.length) throw new ConflictException('Only a requisition waiting for review can be approved or rejected');
      const { rows: owner } = await client.query<{ email: string; first_name: string | null }>(
        `SELECT email, first_name FROM user_accounts WHERE id = $1`, [rows[0].owner_id],
      );
      if (owner[0]) {
        await this.email.enqueue('job-approval-decision', owner[0].email, {
          firstName: owner[0].first_name ?? '', jobTitle: rows[0].title, decision, note: note?.trim() || null,
          path: `/platform/requisitions?id=${encodeURIComponent(id)}`,
        }, { client, userId: rows[0].owner_id, dedupeKey: `job-approval:${id}:${Date.now()}` });
      }
      return this.mapRow(rows[0]);
    });
  }

  /** Deletes a requisition nobody has applied to; otherwise close it instead. */
  async remove(id: string, user: User): Promise<{ id: string; deleted: true }> {
    const existing = await this.findOne(id, user);
    if (existing.ownerId !== user.id && user.role !== 'Admin') {
      throw new ForbiddenException('Only the owner can delete a requisition');
    }
    const { rowCount } = await this.db.query(
      `DELETE FROM requisitions r WHERE r.id = $1
          AND NOT EXISTS (SELECT 1 FROM applications a WHERE a.requisition_id = r.id)`,
      [id],
    );
    if (!rowCount) throw new ConflictException('This requisition has applications; close it instead of deleting it');
    return { id, deleted: true };
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
      // Rows from before migration 018 have no posting columns.
      ...(row.is_public === undefined ? {} : {
        posting: {
          isPublic:       Boolean(row.is_public),
          employmentType: row.employment_type,
          locationType:   row.location_type,
          salaryMin:      row.salary_min == null ? null : Number(row.salary_min),
          salaryMax:      row.salary_max == null ? null : Number(row.salary_max),
          salaryCurrency: row.salary_currency,
          requirements:   row.requirements ?? [],
          expiresAt:      iso(row.expires_at),
          publishedAt:    iso(row.published_at),
        },
      }),
      ...(row.approval_status === undefined ? {} : {
        approval: {
          status:      row.approval_status,
          note:        row.approval_note ?? null,
          submittedAt: iso(row.approval_submitted_at),
          reviewedAt:  iso(row.approval_reviewed_at),
        },
        screeningQuestions: row.screening_questions ?? [],
        evaluationRubric:   row.evaluation_rubric ?? [],
      }),
      createdAt:    iso(row.created_at) ?? '',
      updatedAt:    iso(row.updated_at) ?? '',
    };
  }
}
