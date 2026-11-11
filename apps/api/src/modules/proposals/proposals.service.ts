import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import type { Proposal, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { SubmitProposalDto } from './dto/submit-proposal.dto';
import { mapProposalRow, ProposalRow } from './proposal.mapper';

/** A bid can only be awarded while the project is still collecting or shortlisting bids. */
export const AWARDABLE_STAGES: readonly string[] = ['Open for Bids', 'Shortlisting'];

/** Bids whose contract the expert declined or the buyer withdrew: never awarded again. */
const CLOSED_STATUSES = ['Declined', 'Withdrawn'];

@Injectable()
export class ProposalsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  /** Only the project's buyer (or an admin) sees the bids on it. */
  async findForProject(projectId: string, user: User): Promise<Proposal[]> {
    const { rows: projectRows } = await this.db.query<{ buyer_id: string }>(
      `SELECT buyer_id FROM projects WHERE id = $1`,
      [projectId],
    );
    if (!projectRows.length) throw new NotFoundException('Project not found');
    if (projectRows[0].buyer_id !== user.id && user.role !== 'Admin') throw new ForbiddenException();

    const { rows } = await this.db.query<ProposalRow>(
      `SELECT p.*, CONCAT_WS(' ', u.first_name, u.last_name) AS expert_name, c.id AS contract_id
         FROM proposals p JOIN user_accounts u ON p.expert_id = u.id
         LEFT JOIN contracts c ON c.proposal_id = p.id
        WHERE p.project_id = $1 ORDER BY p.created_at ASC`,
      [projectId],
    );
    return rows.map(mapProposalRow);
  }

  async findMine(userId: string): Promise<Proposal[]> {
    const { rows } = await this.db.query<ProposalRow>(
      `SELECT p.*, pr.title AS project_title, pr.stage AS project_stage, c.id AS contract_id
         FROM proposals p JOIN projects pr ON p.project_id = pr.id
         LEFT JOIN contracts c ON c.proposal_id = p.id
        WHERE p.expert_id = $1 ORDER BY p.created_at DESC`,
      [userId],
    );
    return rows.map(mapProposalRow);
  }

  async submit(dto: SubmitProposalDto, user: User): Promise<Proposal> {
    const { rows: projectRows } = await this.db.query<{ stage: string }>(
      `SELECT stage FROM projects WHERE id = $1`,
      [dto.projectId],
    );
    if (!projectRows.length) throw new NotFoundException('Project not found');
    if (projectRows[0].stage !== 'Open for Bids') throw new BadRequestException('This project is not taking bids');

    // Idempotent: a second bid (even a concurrent one) returns the existing proposal.
    const { rows } = await this.db.query<ProposalRow>(
      `INSERT INTO proposals (id, project_id, expert_id, price, days, note)
       VALUES ($1,$2,$3,$4,$5,$6)
       ON CONFLICT (project_id, expert_id) DO NOTHING
       RETURNING *`,
      [generateId('P'), dto.projectId, user.id, dto.price, dto.days, dto.note ?? ''],
    );
    if (rows.length) return mapProposalRow(rows[0]);
    const existing = await this.db.query<ProposalRow>(
      `SELECT * FROM proposals WHERE project_id = $1 AND expert_id = $2`,
      [dto.projectId, user.id],
    );
    return mapProposalRow(existing.rows[0]);
  }

  /**
   * Awards one bid and rejects the rest, atomically. Locks the project, then its proposals
   * (ContractsService takes the same order when a cancel reopens a project). A 'Declined'
   * or 'Withdrawn' bid can't be awarded again and keeps its status.
   */
  async award(proposalId: string, user: User) {
    return withTransaction(this.db, async (client) => {
      const { rows: pRows } = await client.query<ProposalRow>(`SELECT * FROM proposals WHERE id = $1`, [proposalId]);
      if (!pRows.length) throw new NotFoundException('Proposal not found');
      const proposal = pRows[0];
      if (CLOSED_STATUSES.includes(proposal.status)) {
        throw new ConflictException(`A '${proposal.status}' proposal cannot be awarded`);
      }

      const { rows: prRows } = await client.query(
        `SELECT buyer_id, stage FROM projects WHERE id = $1 FOR UPDATE`,
        [proposal.project_id],
      );
      if (!prRows.length) throw new NotFoundException('Project not found');
      if (prRows[0].buyer_id !== user.id) throw new ForbiddenException();
      if (!AWARDABLE_STAGES.includes(prRows[0].stage)) {
        throw new ConflictException(`A project in stage '${prRows[0].stage}' can no longer be awarded`);
      }

      // Re-checks the awarded bid's status now that the project is locked: a contract
      // cancel may have withdrawn it since the read above.
      const { rows: updated } = await client.query<{ id: string }>(
        `UPDATE proposals
            SET status = CASE WHEN id = $2 THEN 'Awarded'
                              WHEN status = ANY($3::text[]) THEN status
                              ELSE 'Rejected' END,
                updated_at = NOW()
          WHERE project_id = $1
            AND NOT EXISTS (SELECT 1 FROM proposals x WHERE x.id = $2 AND x.status = ANY($3::text[]))
          RETURNING id`,
        [proposal.project_id, proposalId, CLOSED_STATUSES],
      );
      if (!updated.some((r) => r.id === proposalId)) {
        throw new ConflictException('This proposal can no longer be awarded');
      }

      await client.query(
        `UPDATE projects SET stage = 'Contracted', awarded_to = $1, updated_at = NOW() WHERE id = $2`,
        [proposal.expert_id, proposal.project_id],
      );
      return { awarded: true, projectId: proposal.project_id, expertId: proposal.expert_id };
    });
  }
}
