import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import type { ApplicationStage, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { assertTenantAccess } from '../../common/utils/access';
import { generateId } from '../../common/utils/ids';
import { ApplicationRow, mapApplicationRow } from './application.mapper';
import { AddScorecardDto } from './dto/application.dto';

@Injectable()
export class ApplicationsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findForRequisition(reqId: string, user: User) {
    const { rows: reqRows } = await this.db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM requisitions WHERE id = $1`,
      [reqId],
    );
    if (!reqRows.length) throw new NotFoundException('Requisition not found');
    assertTenantAccess(user, reqRows[0].tenant_id);

    const { rows } = await this.db.query<ApplicationRow>(
      `SELECT a.*, CONCAT_WS(' ', u.first_name, u.last_name) AS candidate_name,
              u.email AS candidate_email
         FROM applications a
         JOIN user_accounts u ON a.candidate_id = u.id
        WHERE a.requisition_id = $1
        ORDER BY a.created_at DESC`,
      [reqId],
    );
    return rows.map(mapApplicationRow);
  }

  /** Candidates see their own applications; employers only those made to their tenant. */
  async findForCandidate(candidateId: string, user: User) {
    const params: unknown[] = [candidateId];
    let scope = '';
    if (user.role === 'Candidate') {
      if (user.id !== candidateId) return [];
    } else if (user.role !== 'Admin') {
      if (!user.tenantId) return [];
      params.push(user.tenantId);
      scope = 'AND a.tenant_id = $2';
    }
    const { rows } = await this.db.query<ApplicationRow>(
      `SELECT a.*, r.title AS req_title, r.industry, r.tier
         FROM applications a
         JOIN requisitions r ON a.requisition_id = r.id
        WHERE a.candidate_id = $1 ${scope}
        ORDER BY a.created_at DESC`,
      params,
    );
    return rows.map(mapApplicationRow);
  }

  async apply(reqId: string, candidateId: string) {
    // An expired public posting no longer takes applications (the board already hides it).
    const { rows: reqRows } = await this.db.query<{ tenant_id: string; status: string }>(
      `SELECT tenant_id, status FROM requisitions WHERE id = $1 AND (expires_at IS NULL OR expires_at > NOW())`,
      [reqId],
    );
    if (!reqRows.length || reqRows[0].status !== 'Open') {
      throw new NotFoundException('Requisition not found or not open for applications');
    }

    const history = JSON.stringify([{ t: Date.now(), stage: 'Applied', by: 'system' }]);
    // Idempotent: a second apply (even a concurrent one) returns the existing application.
    const { rows } = await this.db.query<ApplicationRow>(
      `INSERT INTO applications (id, candidate_id, requisition_id, tenant_id, stage, history)
       VALUES ($1, $2, $3, $4, 'Applied', $5::jsonb)
       ON CONFLICT (requisition_id, candidate_id) DO NOTHING
       RETURNING *`,
      [generateId('A'), candidateId, reqId, reqRows[0].tenant_id, history],
    );
    if (!rows.length) {
      const existing = await this.db.query<ApplicationRow>(
        `SELECT * FROM applications WHERE requisition_id = $1 AND candidate_id = $2`,
        [reqId, candidateId],
      );
      return mapApplicationRow(existing.rows[0]);
    }
    return mapApplicationRow(rows[0]);
  }

  async advanceStage(appId: string, stage: ApplicationStage, byName: string, user: User) {
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<ApplicationRow>(
        `SELECT * FROM applications WHERE id = $1 FOR UPDATE`,
        [appId],
      );
      if (!rows.length) throw new NotFoundException('Application not found');
      assertTenantAccess(user, rows[0].tenant_id);

      const history = [...(rows[0].history ?? []), { t: Date.now(), stage, by: byName }];
      const { rows: updated } = await client.query<ApplicationRow>(
        `UPDATE applications SET stage = $1, history = $2::jsonb, updated_at = NOW()
          WHERE id = $3 RETURNING *`,
        [stage, JSON.stringify(history), appId],
      );
      return mapApplicationRow(updated[0]);
    });
  }

  async addScorecard(appId: string, data: AddScorecardDto, user: User) {
    const { rows: appRows } = await this.db.query<{ tenant_id: string }>(
      `SELECT tenant_id FROM applications WHERE id = $1`,
      [appId],
    );
    if (!appRows.length) throw new NotFoundException('Application not found');
    assertTenantAccess(user, appRows[0].tenant_id);

    await this.db.query(
      `INSERT INTO scorecards (application_id, scored_by, score, note) VALUES ($1, $2, $3, $4)`,
      [appId, user.id, data.score, data.note],
    );
    const { rows } = await this.db.query(
      `SELECT * FROM scorecards WHERE application_id = $1 ORDER BY created_at DESC`,
      [appId],
    );
    return rows;
  }
}
