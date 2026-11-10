import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import type { Milestone, ProjectStage, User } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';
import { CreateDisputeDto, CreateProjectDto } from './dto/project.dto';
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

  async findServices() {
    return [
      { id: 'SRV-1', title: 'Full-Stack Security & Compliance Audit', domain: 'Security', price: 85000, days: 7, description: 'Comprehensive code review, OWASP dependency audit, and penetration testing report.', expertName: 'Aarav Sharma', rating: 4.9 },
      { id: 'SRV-2', title: 'High-Throughput Kafka / Event Streaming Setup', domain: 'Distributed systems', price: 120000, days: 10, description: 'Production-ready Kafka broker setup with zero-data-loss architecture and monitoring.', expertName: 'Aarav Sharma', rating: 5.0 },
      { id: 'SRV-3', title: 'LLM Prompt Engineering & Eval Harness', domain: 'AI / ML', price: 75000, days: 5, description: 'Automated test suite measuring hallucination, tone, latency, and token efficiency.', expertName: 'NovaStack AI Labs', rating: 4.8 },
      { id: 'SRV-4', title: 'HIPAA & Healthcare Data Pipeline Certification', domain: 'Healthcare', price: 110000, days: 14, description: 'End-to-end encryption verification, audit trails, and BAA compliance checklist.', expertName: 'Dr. Priya Menon', rating: 4.9 },
    ];
  }

  async findDisputes(user: User) {
    if (user.role === 'Admin') {
      const { rows } = await this.db.query(
        `SELECT d.*, p.title AS project_title,
                u1.first_name || ' ' || u1.last_name AS raised_by_name,
                u2.first_name || ' ' || u2.last_name AS raised_against_name
         FROM disputes d
         LEFT JOIN projects p ON p.id = d.project_id
         LEFT JOIN user_accounts u1 ON u1.id = d.raised_by
         LEFT JOIN user_accounts u2 ON u2.id = d.raised_against
         ORDER BY d.created_at DESC`,
      );
      return rows;
    }
    const { rows } = await this.db.query(
      `SELECT d.*, p.title AS project_title,
              u1.first_name || ' ' || u1.last_name AS raised_by_name,
              u2.first_name || ' ' || u2.last_name AS raised_against_name
       FROM disputes d
       LEFT JOIN projects p ON p.id = d.project_id
       LEFT JOIN user_accounts u1 ON u1.id = d.raised_by
       LEFT JOIN user_accounts u2 ON u2.id = d.raised_against
       WHERE d.raised_by = $1 OR d.raised_against = $1
       ORDER BY d.created_at DESC`,
      [user.id],
    );
    return rows;
  }

  /** Only between the two parties of a contracted project: its buyer and awarded freelancer. */
  async createDispute(data: CreateDisputeDto, user: User) {
    const { rows: projectRows } = await this.db.query<Pick<ProjectRow, 'buyer_id' | 'awarded_to'>>(
      `SELECT buyer_id, awarded_to FROM projects WHERE id = $1`,
      [data.projectId],
    );
    if (!projectRows.length) throw new NotFoundException('Project not found');
    const { buyer_id: buyerId, awarded_to: freelancerId } = projectRows[0];
    if (!freelancerId) throw new BadRequestException('A dispute needs an awarded project');
    const parties = [buyerId, freelancerId];
    if (!parties.includes(user.id)) throw new ForbiddenException();
    if (data.raisedAgainst === user.id || !parties.includes(data.raisedAgainst)) {
      throw new BadRequestException('A dispute must be raised against the other party of the project');
    }

    const id = generateId('DISP');
    const timeline = JSON.stringify([{ date: new Date().toISOString().slice(0, 10), note: `Dispute opened by ${user.firstName}: ${data.reason}` }]);
    const { rows } = await this.db.query(
      `INSERT INTO disputes (id, project_id, raised_by, raised_against, reason, status, timeline)
       VALUES ($1, $2, $3, $4, $5, 'Open', $6::jsonb) RETURNING *`,
      [id, data.projectId, user.id, data.raisedAgainst, data.reason, timeline],
    );
    return rows[0];
  }

  async resolveDispute(id: string, resolution: string) {
    const { rows } = await this.db.query(
      `UPDATE disputes SET status = 'Resolved', resolution = $1, updated_at = NOW() WHERE id = $2 RETURNING *`,
      [resolution, id],
    );
    if (!rows.length) throw new NotFoundException('Dispute not found');
    return rows[0];
  }
}
