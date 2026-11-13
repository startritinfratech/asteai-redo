import {
  BadGatewayException, ConflictException, ForbiddenException, HttpException, Inject, Injectable, Logger,
  NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Pool, PoolClient } from 'pg';
import type {
  AssessmentItem, AssessmentSessionAdmin, AssessmentSessionStatus, AssessmentStep, User,
} from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { AiService } from '../ai/ai.service';
import { NotificationsService } from '../notifications/notifications.service';
import { EmailService } from '../email/email.service';
import { generateId } from '../../common/utils/ids';
import { AnswerAssessmentDto } from './dto/assessment.dto';

/** A finished session as deeptech_ai scores it (psychometric/engine.py `finish`). */
export interface ScoredSession {
  session_id: string;
  candidate_id: string;
  requisition_id: string;
  language: string;
  theta: { iq: number; eq: number; grit: number };
  sten: { iq: number; eq: number; grit: number };
  fit: number;
  ci: number;
  integrity: 'Clear' | 'Review' | 'High Concern';
  integ: { blur: number; paste: number; fast: number };
  n: { iq: number; eq: number; grit: number };
  duration_sec: number;
  events: unknown[];
  self: number | null;
  safety: boolean | null;
}

interface AiStep {
  session_id: string;
  done: boolean;
  item?: AssessmentItem;
  result?: ScoredSession;
}

/** Sessions joined with the candidate, requisition and resetting admin, for admin views. */
const SESSION_ADMIN_SELECT = `
  SELECT s.*, r.title AS requisition_title, r.tenant_id,
         u.email AS candidate_email, TRIM(CONCAT(u.first_name, ' ', u.last_name)) AS candidate_name,
         TRIM(CONCAT(a.first_name, ' ', a.last_name)) AS reset_by_name
    FROM assessment_sessions s
    JOIN requisitions r ON r.id = s.requisition_id
    JOIN user_accounts u ON u.id = s.candidate_id
    LEFT JOIN user_accounts a ON a.id = s.reset_by`;

/** Application stages a finished assessment may move on to 'Assessment Review'. */
const PRE_REVIEW_STAGES = `('Applied', 'Eligibility', 'Assessment Pending')`;

/** deeptech_ai statuses the candidate should see as-is rather than as a 502. */
const PASS_THROUGH = new Map<number, (msg: string) => HttpException>([
  [404, (m) => new NotFoundException(m)],
  [409, (m) => new ConflictException(m)],
  [422, (m) => new HttpException(m, 422)],
]);

@Injectable()
export class AssessmentsService {
  private readonly logger = new Logger(AssessmentsService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly ai: AiService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  /**
   * Starts the role-fit battery for one application, or resumes it. deeptech_ai holds
   * the questions, answers and scores; this API only passes steps through and stores
   * the finished result. The requisition's settings come from this database, never
   * from the browser.
   */
  async start(user: User, requisitionId: string): Promise<AssessmentStep> {
    const { rows } = await this.db.query(
      `SELECT r.tier, r.industry, r.weight_iq, r.weight_eq, r.weight_grit, r.stack, r.language,
              r.status AS req_status, a.result_id, a.stage
         FROM applications a
         JOIN requisitions r ON r.id = a.requisition_id
        WHERE a.candidate_id = $1 AND a.requisition_id = $2`,
      [user.id, requisitionId],
    );
    if (!rows.length) throw new NotFoundException('Apply to this requisition before taking its assessment');
    const req = rows[0];
    if (req.result_id) throw new ConflictException('You have already completed this assessment');
    if (req.stage === 'Rejected') throw new ConflictException('This application is closed');

    const existing = await this.sessionFor(user.id, requisitionId);
    if (existing) return this.resume(user, existing);
    if (req.req_status !== 'Open') throw new ConflictException('This requisition is not accepting assessments');

    const step = await this.callAi<AiStep>(() => this.ai.post('/api/psychometric/sessions', {
      candidate_id: user.id,
      requisition_id: requisitionId,
      tier: req.tier,
      industry: req.industry,
      weights: { iq: req.weight_iq, eq: req.weight_eq, grit: req.weight_grit },
      stack: req.stack ?? [],
      language: req.language,
    }));

    const inserted = await this.db.query(
      `INSERT INTO assessment_sessions (id, candidate_id, requisition_id) VALUES ($1, $2, $3)
       ON CONFLICT (candidate_id, requisition_id) WHERE status <> 'reset' DO NOTHING`,
      [step.session_id, user.id, requisitionId],
    );
    if (!inserted.rowCount) {
      // A parallel start won; continue that one (the session just created expires unused).
      return this.resume(user, (await this.sessionFor(user.id, requisitionId))!);
    }
    return { sessionId: step.session_id, done: false, item: step.item };
  }

  /** The current item of the candidate's own session (after a reload). */
  async current(user: User, sessionId: string): Promise<AssessmentStep> {
    return this.resume(user, await this.ownSession(user, sessionId));
  }

  async answer(user: User, sessionId: string, dto: AnswerAssessmentDto): Promise<AssessmentStep> {
    const session = await this.ownSession(user, sessionId);
    if (session.status === 'completed') return { sessionId, done: true, resultId: session.result_id };
    if (session.status === 'expired') throw this.expired();
    if (session.status === 'reset') throw this.wasReset();

    const step = await this.callAi<AiStep>(() =>
      this.ai.post(`/api/psychometric/sessions/${encodeURIComponent(sessionId)}/answer`, {
        candidate_id: user.id,
        item_id: dto.itemId,
        response: dto.response,
        events: dto.events ?? {},
      }),
    ).catch((err) => this.markExpiredIfGone(err, sessionId));

    if (!step.done) return { sessionId, done: false, item: step.item };
    const resultId = await this.storeResult(user.id, session.requisition_id, step.result!);
    return { sessionId, done: true, resultId };
  }

  /**
   * Saves a finished session: result, application stage, integrity queue and session
   * status in one transaction. Saving the same session twice keeps the first result.
   */
  async storeResult(candidateId: string, requisitionId: string, r: ScoredSession): Promise<string> {
    if (r.candidate_id !== candidateId || r.requisition_id !== requisitionId) {
      // deeptech_ai checks ownership too; a mismatch means a bug, not a candidate.
      this.logger.error(`Scored session ${r.session_id} does not match ${candidateId}/${requisitionId}`);
      throw new ForbiddenException();
    }

    return withTransaction(this.db, async (client) => {
      const id = generateId('R');
      const hash = createHash('sha256')
        .update(JSON.stringify({ id, candidateId, session: r.session_id, sten: r.sten, fit: r.fit }))
        .digest('hex')
        .slice(0, 16);

      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO assessment_results
           (id, candidate_id, requisition_id, session_id,
            theta_iq, theta_eq, theta_grit, sten_iq, sten_eq, sten_grit,
            fit_score, ci_score, integrity, integ_blur, integ_paste, integ_fast,
            n_iq, n_eq, n_grit, duration_sec, ev_data, self_data, safety_data, hash)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,
                 $21::jsonb,$22::jsonb,$23::jsonb,$24)
         ON CONFLICT (session_id) DO NOTHING
         RETURNING id`,
        [
          id, candidateId, requisitionId, r.session_id,
          r.theta.iq, r.theta.eq, r.theta.grit, r.sten.iq, r.sten.eq, r.sten.grit,
          r.fit, r.ci, r.integrity, r.integ.blur, r.integ.paste, r.integ.fast,
          r.n.iq, r.n.eq, r.n.grit, r.duration_sec,
          JSON.stringify(r.events ?? []),
          JSON.stringify({ selfReportedGrit: r.self }),
          JSON.stringify({ passed: r.safety }),
          hash,
        ],
      );
      if (!rows.length) return this.existingResultId(client, r.session_id);

      // Attach the result; only move the stage forward if the application is still before
      // review (a candidate shortlisted or rejected meanwhile keeps that stage).
      await client.query(
        `UPDATE applications
            SET result_id = $1,
                stage = CASE WHEN stage IN ${PRE_REVIEW_STAGES} THEN 'Assessment Review'::application_stage_enum ELSE stage END,
                history = CASE WHEN stage IN ${PRE_REVIEW_STAGES}
                               THEN COALESCE(history, '[]'::jsonb) || $4::jsonb ELSE history END,
                updated_at = NOW()
          WHERE candidate_id = $2 AND requisition_id = $3 AND result_id IS NULL`,
        [id, candidateId, requisitionId, JSON.stringify([{ t: Date.now(), stage: 'Assessment Review', by: 'system' }])],
      );
      await client.query(
        `UPDATE assessment_sessions SET status = 'completed', result_id = $1, completed_at = NOW() WHERE id = $2`,
        [id, r.session_id],
      );
      if (r.integrity !== 'Clear') {
        await client.query(
          `INSERT INTO integrity_queue (id, result_id, reason) VALUES ($1, $2, $3)`,
          [generateId('IQ'), id,
           `${r.integ.blur} foreground exits, ${r.integ.paste} paste events, ${r.integ.fast} sub-1.5s responses`],
        );
      }
      return id;
    });
  }

  /**
   * The candidate, an employer of a tenant they applied to, or an admin. The candidate
   * doesn't get the per-item evidence or raw theta estimates (they reveal the answer key).
   */
  async findResult(id: string, user: User) {
    const { rows } = await this.db.query(`SELECT * FROM assessment_results WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Result ${id} not found`);
    const result = rows[0];

    if (user.role === 'Admin') return result;
    if (result.candidate_id === user.id) {
      const { ev_data: _ev, theta_iq: _iq, theta_eq: _eq, theta_grit: _grit, ...own } = result;
      return own;
    }
    if (user.role === 'Employer' && user.tenantId) {
      const { rowCount } = await this.db.query(
        `SELECT 1 FROM applications WHERE result_id = $1 AND tenant_id = $2`,
        [id, user.tenantId],
      );
      if (rowCount) return result;
    }
    throw new ForbiddenException();
  }

  /**
   * Open integrity flags. Admins see every tenant; an employer only sees flags on results
   * that belong to an application in their own tenant.
   */
  async getIntegrityQueue(user: Pick<User, 'role' | 'tenantId'>) {
    if (user.role === 'Admin') {
      const { rows } = await this.db.query(
        `SELECT iq.*, ar.candidate_id, ar.fit_score, ar.integrity
           FROM integrity_queue iq
           JOIN assessment_results ar ON iq.result_id = ar.id
          WHERE iq.status = 'Open'
          ORDER BY iq.created_at ASC`,
      );
      return rows;
    }
    if (!user.tenantId) return [];
    const { rows } = await this.db.query(
      `SELECT iq.*, ar.candidate_id, ar.fit_score, ar.integrity
         FROM integrity_queue iq
         JOIN assessment_results ar ON iq.result_id = ar.id
        WHERE iq.status = 'Open'
          AND EXISTS (SELECT 1 FROM applications a WHERE a.result_id = iq.result_id AND a.tenant_id = $1)
        ORDER BY iq.created_at ASC`,
      [user.tenantId],
    );
    return rows;
  }

  /** Resolves a flag. A flag outside the employer's tenant is reported as missing (404). */
  async resolveIntegrity(id: string, resolution: string, user: Pick<User, 'id' | 'role' | 'tenantId'>) {
    const isAdmin = user.role === 'Admin';
    if (!isAdmin && !user.tenantId) throw new NotFoundException();
    const { rows } = await this.db.query(
      `UPDATE integrity_queue iq
          SET status = 'Resolved', resolution = $1, reviewed_by = $2, updated_at = NOW()
        WHERE iq.id = $3
          AND ($4::boolean OR EXISTS (
                SELECT 1 FROM applications a WHERE a.result_id = iq.result_id AND a.tenant_id = $5))
        RETURNING iq.*`,
      [resolution, user.id, id, isAdmin, isAdmin ? null : user.tenantId],
    );
    if (!rows.length) throw new NotFoundException();
    return rows[0];
  }

  /** Sessions for admins, newest first, optionally by status. */
  async listSessions(status: AssessmentSessionStatus | undefined, limit = 100): Promise<AssessmentSessionAdmin[]> {
    const { rows } = await this.db.query(
      `${SESSION_ADMIN_SELECT}
        WHERE ($1::text IS NULL OR s.status = $1)
        ORDER BY s.started_at DESC
        LIMIT $2`,
      [status ?? null, limit],
    );
    return rows.map(mapSessionRow);
  }

  /**
   * Lets the candidate start again after an expired or stuck session. The old session
   * stays as history (status 'reset', with who, when and why), the reset is audited, and
   * the candidate gets an in-app notification and an email linking back to the assessment.
   * A completed session can't be reset: its result exists and goes through integrity review.
   */
  async resetSession(admin: User, sessionId: string, reason: string): Promise<AssessmentSessionAdmin> {
    await withTransaction(this.db, async (client) => {
      const { rows } = await client.query(
        `SELECT s.status, s.candidate_id, s.requisition_id, r.title AS requisition_title,
                u.email AS candidate_email, u.first_name AS candidate_first_name
           FROM assessment_sessions s
           JOIN requisitions r ON r.id = s.requisition_id
           JOIN user_accounts u ON u.id = s.candidate_id
          WHERE s.id = $1 FOR UPDATE OF s`,
        [sessionId],
      );
      if (!rows.length) throw new NotFoundException('Assessment session not found');
      const {
        status, candidate_id: candidateId, requisition_id: requisitionId, requisition_title: title,
        candidate_email: candidateEmail, candidate_first_name: firstName,
      } = rows[0];
      if (status === 'completed') {
        throw new ConflictException('A completed assessment cannot be reset. Use the integrity review instead.');
      }
      if (status === 'reset') throw new ConflictException('This session has already been reset');

      await client.query(
        `UPDATE assessment_sessions
            SET status = 'reset', reset_by = $2, reset_reason = $3, reset_at = NOW()
          WHERE id = $1`,
        [sessionId, admin.id, reason],
      );
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
         VALUES ($1, $2, $3, 'Reset assessment session', $4, $5)`,
        [
          admin.id, [admin.firstName, admin.lastName].filter(Boolean).join(' '), admin.role, sessionId,
          JSON.stringify({ previousStatus: status, candidateId, requisitionId, reason }),
        ],
      );
      // The admin's reason can hold internal notes, so the candidate gets a plain message.
      const path = `/platform/assess?req=${encodeURIComponent(requisitionId)}`;
      await this.notifications.send(
        candidateId, `Support has reset your assessment for ${title}. You can start it again now.`, path, client,
      );
      await this.email.enqueue(
        'assessment-reset', candidateEmail, { firstName: firstName ?? '', requisitionTitle: title, path },
        { userId: candidateId, dedupeKey: `assessment-reset:${sessionId}`, client },
      );
    });
    const { rows } = await this.db.query(
      `${SESSION_ADMIN_SELECT} WHERE s.id = $1`,
      [sessionId],
    );
    return mapSessionRow(rows[0]);
  }

  // ── internals ──

  private async sessionFor(candidateId: string, requisitionId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM assessment_sessions WHERE candidate_id = $1 AND requisition_id = $2 AND status <> 'reset'`,
      [candidateId, requisitionId],
    );
    return rows[0] ?? null;
  }

  private async ownSession(user: User, sessionId: string) {
    const { rows } = await this.db.query(
      `SELECT * FROM assessment_sessions WHERE id = $1 AND candidate_id = $2`,
      [sessionId, user.id],
    );
    if (!rows.length) throw new NotFoundException('Assessment session not found');
    return rows[0];
  }

  private async resume(user: User, session: { id: string; status: string; result_id: string | null }) {
    if (session.status === 'completed') return { sessionId: session.id, done: true, resultId: session.result_id ?? undefined };
    if (session.status === 'expired') throw this.expired();
    if (session.status === 'reset') throw this.wasReset();
    const step = await this.callAi<AiStep>(() =>
      this.ai.get(`/api/psychometric/sessions/${encodeURIComponent(session.id)}?candidate_id=${encodeURIComponent(user.id)}`),
    ).catch((err) => this.markExpiredIfGone(err, session.id));
    if (step.done) {
      // Finished on deeptech_ai but not stored here (the store failed): store it now.
      const { rows } = await this.db.query(`SELECT requisition_id FROM assessment_sessions WHERE id = $1`, [session.id]);
      const resultId = await this.storeResult(user.id, rows[0].requisition_id, step.result!);
      return { sessionId: session.id, done: true, resultId };
    }
    return { sessionId: session.id, done: false, item: step.item };
  }

  /** deeptech_ai keeps sessions for a few hours; one it no longer has can't be resumed. */
  private async markExpiredIfGone(err: unknown, sessionId: string): Promise<never> {
    if (err instanceof NotFoundException) {
      await this.db.query(`UPDATE assessment_sessions SET status = 'expired' WHERE id = $1 AND status = 'active'`, [sessionId]);
      throw this.expired();
    }
    throw err;
  }

  private expired() {
    return new ConflictException('This assessment session has expired. Contact support to have it reset.');
  }

  private wasReset() {
    return new ConflictException('Support has reset this assessment. Open it again from Take Assessment to start over.');
  }

  private async existingResultId(client: PoolClient, sessionId: string): Promise<string> {
    const { rows } = await client.query<{ id: string }>(
      `SELECT id FROM assessment_results WHERE session_id = $1`, [sessionId],
    );
    return rows[0].id;
  }

  /**
   * Runs a deeptech_ai call, turning its 404 / 409 / 422 into the same status here.
   * A 5xx or an unreachable service becomes a retryable 503; the session is left as is.
   */
  private async callAi<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const status = (err as { aiStatus?: number }).aiStatus;
      if (err instanceof BadGatewayException && (status === undefined || status >= 500)) {
        throw new ServiceUnavailableException('The assessment service is temporarily unavailable. Please try again.');
      }
      const make = status ? PASS_THROUGH.get(status) : undefined;
      if (!make) throw err;
      let message = 'The assessment service rejected this request';
      try {
        const detail = (JSON.parse((err as { aiBody?: string }).aiBody ?? '') as { detail?: unknown }).detail;
        if (typeof detail === 'string') message = detail;
      } catch {
        // keep the generic message
      }
      throw make(message);
    }
  }
}

const iso = (v: unknown) => (v == null ? null : new Date(v as string).toISOString());

function mapSessionRow(r: Record<string, unknown>): AssessmentSessionAdmin {
  return {
    id: r.id as string,
    status: r.status as AssessmentSessionStatus,
    candidateId: r.candidate_id as string,
    candidateName: (r.candidate_name as string) || '',
    candidateEmail: r.candidate_email as string,
    requisitionId: r.requisition_id as string,
    requisitionTitle: r.requisition_title as string,
    tenantId: r.tenant_id as string,
    startedAt: iso(r.started_at) ?? '',
    completedAt: iso(r.completed_at),
    resultId: (r.result_id as string | null) ?? null,
    resetAt: iso(r.reset_at),
    resetReason: (r.reset_reason as string | null) ?? null,
    resetByName: (r.reset_by_name as string) || null,
  };
}
