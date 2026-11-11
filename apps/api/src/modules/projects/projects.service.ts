import {
  ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { Milestone, ProjectStage, User } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';
import { CreateProjectDto } from './dto/project.dto';
import { canMoveProjectStage, ProjectParty } from './project-transitions';
import { mapProjectRow, ProjectRow } from './project.mapper';

function partyOf(project: Pick<ProjectRow, 'buyer_id' | 'awarded_to'>, user: User): ProjectParty {
  return {
    isAdmin: user.role === 'Admin',
    isBuyer: project.buyer_id === user.id,
    isFreelancer: project.awarded_to !== null && project.awarded_to === user.id,
  };
}

/** The project's contract, if one was created for its awarded proposal (one per proposal). */
const CONTRACT_ID = `(SELECT c.id FROM contracts c WHERE c.project_id = p.id ORDER BY c.created_at DESC LIMIT 1) AS contract_id`;

const WITH_BUYER = `SELECT p.*, CONCAT_WS(' ', u.first_name, u.last_name) AS buyer_name, ${CONTRACT_ID}
  FROM projects p JOIN user_accounts u ON p.buyer_id = u.id`;

@Injectable()
export class ProjectsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findOpen({ pageSize, offset }: Pagination) {
    const { rows } = await this.db.query<ProjectRow>(
      `${WITH_BUYER} WHERE p.stage = 'Open for Bids' ORDER BY p.created_at DESC LIMIT $1 OFFSET $2`,
      [pageSize, offset],
    );
    return rows.map(mapProjectRow);
  }

  async findForUser(userId: string, role: 'buyer' | 'freelancer') {
    const field = role === 'buyer' ? 'buyer_id' : 'awarded_to';
    const { rows } = await this.db.query<ProjectRow>(
      `SELECT p.*, ${CONTRACT_ID} FROM projects p WHERE p.${field} = $1 ORDER BY p.created_at DESC`,
      [userId],
    );
    return rows.map(mapProjectRow);
  }

  private async load(id: string): Promise<ProjectRow> {
    const { rows } = await this.db.query<ProjectRow>(`${WITH_BUYER} WHERE p.id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Project ${id} not found`);
    return rows[0];
  }

  /**
   * The buyer, the awarded freelancer and admins always see the project; anyone else
   * only while it is open for bids and not under NDA.
   */
  async findOne(id: string, user: User) {
    const project = await this.load(id);
    const party = partyOf(project, user);
    const isPublic = project.stage === 'Open for Bids' && !project.nda_required;
    if (!party.isAdmin && !party.isBuyer && !party.isFreelancer && !isPublic) throw new ForbiddenException();
    return mapProjectRow(project);
  }

  async create(dto: CreateProjectDto, user: User) {
    const milestones: Milestone[] = (dto.milestones ?? []).map((m) => ({
      id: randomUUID(),
      name: m.name,
      amount: m.amount,
      status: 'Pending',
      dueDate: m.dueDate ?? 0,
    }));
    const { rows } = await this.db.query<ProjectRow>(
      `INSERT INTO projects (id, buyer_id, tenant_id, title, domain, budget, description, milestones, nda_required)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9)
       RETURNING *`,
      [
        generateId('PRJ'), user.id, user.tenantId,
        dto.title, dto.domain, dto.budget, dto.description,
        JSON.stringify(milestones), dto.ndaRequired ?? false,
      ],
    );
    return mapProjectRow(rows[0]);
  }

  /** See canMoveProjectStage: forward only, by the buyer; admins may set any stage. */
  async updateStage(id: string, stage: ProjectStage, user: User) {
    const project = await this.load(id);
    const party = partyOf(project, user);
    if (!party.isBuyer && !party.isAdmin) throw new ForbiddenException();
    if (!canMoveProjectStage(party, project.stage, stage, project.awarded_to !== null)) {
      throw new ConflictException(`Cannot move this project from '${project.stage}' to '${stage}'`);
    }
    // Conditional on the stage we checked, so a concurrent change can't be overwritten.
    const { rows } = await this.db.query<ProjectRow>(
      `UPDATE projects SET stage = $1, updated_at = NOW() WHERE id = $2 AND stage = $3 RETURNING *`,
      [stage, id, project.stage],
    );
    if (!rows.length) throw new ConflictException('The project changed meanwhile; reload and try again');
    return mapProjectRow(rows[0]);
  }
}
