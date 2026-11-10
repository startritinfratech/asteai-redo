import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { AiService } from '../ai/ai.service';
import { domainsFor, findFrontlineRole } from './catalogue';
import { StartMockInterviewDto } from './dto/start-mock-interview.dto';

/** JSON posted by deeptech_ai. Untrusted: every field is checked before it is used. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AiResultPayload = Record<string, any>;

export const EVENT_MOCK_INTERVIEW_COMPLETED = 'mock_interview.completed';
export const EVENT_ASSESSMENT_SCORED = 'candidate_assessment.scored';

/** An interview still "in progress" this long after it started never finished. */
const ABANDON_AFTER = '2 hours';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Actor = Pick<User, 'id' | 'email' | 'firstName' | 'lastName' | 'role'>;

/** Columns a candidate gets back. The transcript and audio are only on the detail view. */
const LIST_COLUMNS = `id, category, skill, domain, language, frontline_role_id, status, turns,
  ended_reason, started_at, completed_at,
  (proctoring_summary->>'overall_score')::numeric AS overall_score,
  certificate_content IS NOT NULL AS has_certificate`;

@Injectable()
export class InterviewsService {
  private readonly logger = new Logger(InterviewsService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly ai: AiService,
  ) {}

  // ── Starting ──────────────────────────────────────────────────────────────

  async startMock(user: Actor, dto: StartMockInterviewDto) {
    const domain = dto.domain.trim();
    const skill = dto.skill.trim();
    if (!domainsFor(dto.category).includes(domain)) {
      throw new BadRequestException(`"${domain}" is not a ${dto.category} field`);
    }
    let frontlineRoleId: string | null = null;
    if (dto.category === 'frontline') {
      const role = findFrontlineRole(domain, skill);
      if (!role) throw new BadRequestException(`"${skill}" is not a role in ${domain}`);
      frontlineRoleId = role.roleId;
    }
    const summary = (dto.summary ?? '').trim();
    const language = dto.language ?? 'en';

    const session = this.ai.session(user);
    const started = await this.ai.post<{ success: boolean; mock_interview_id?: string }>(
      '/api/mock-interview/start',
      { candidate_profile_id: user.id, skill, domain, summary },
      session.token,
    );
    const id = started?.mock_interview_id;
    if (!id || !UUID.test(id)) {
      throw new BadRequestException('The AI service did not start the interview');
    }

    const { rows } = await this.db.query(
      `INSERT INTO mock_interviews
         (id, user_id, category, skill, domain, summary, language, frontline_role_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       RETURNING ${LIST_COLUMNS}`,
      [id, user.id, dto.category, skill, domain, summary, language, frontlineRoleId],
    );
    return { interview: rows[0], connection: this.connection(rows[0], summary, session) };
  }

  /**
   * A fresh AI token for an interview the user owns and has not finished (reconnects).
   * Owner only: an admin may read results but must not join a candidate's live interview.
   */
  async session(user: Actor, id: string) {
    const row = await this.owned(user, id);
    if (row.user_id !== user.id) throw new ForbiddenException();
    if (row.status !== 'in_progress') throw new BadRequestException('This interview has finished');
    return this.connection(row, row.summary ?? '', this.ai.session(user));
  }

  /** What the browser needs to reach deeptech_ai for this interview. */
  private connection(
    row: { id: string; skill: string; domain: string; language: string },
    summary: string,
    session: ReturnType<AiService['session']>,
  ) {
    const ws = new URL(`${session.baseUrl}/api/mock-interview/ws/${row.id}`);
    ws.protocol = ws.protocol === 'https:' ? 'wss:' : 'ws:';
    ws.searchParams.set('language', row.language);
    ws.searchParams.set('skill', row.skill);
    ws.searchParams.set('domain', row.domain);
    ws.searchParams.set('summary', summary);
    return {
      wsUrl: ws.toString(),
      faceCheckUrl: `${session.baseUrl}/api/mock-interview/face-check`,
      // Sent as new WebSocket(url, ['bearer', token]) — never in the URL.
      token: session.token,
      expiresInSeconds: session.expiresInSeconds,
    };
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  private async markAbandoned(userId?: string) {
    await this.db.query(
      `UPDATE mock_interviews SET status = 'abandoned', updated_at = NOW()
        WHERE status = 'in_progress' AND started_at < NOW() - INTERVAL '${ABANDON_AFTER}'
          ${userId ? 'AND user_id = $1' : ''}`,
      userId ? [userId] : [],
    );
  }

  async listMine(userId: string) {
    await this.markAbandoned(userId);
    const { rows } = await this.db.query(
      `SELECT ${LIST_COLUMNS} FROM mock_interviews WHERE user_id = $1 ORDER BY started_at DESC LIMIT 100`,
      [userId],
    );
    return rows;
  }

  /** The full record for its owner or an admin. */
  async owned(user: Actor, id: string) {
    if (!UUID.test(id)) throw new NotFoundException('Interview not found');
    const { rows } = await this.db.query(`SELECT * FROM mock_interviews WHERE id = $1`, [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Interview not found');
    if (row.user_id !== user.id && user.role !== 'Admin') throw new ForbiddenException();
    return row;
  }

  async detail(user: Actor, id: string) {
    const row = await this.owned(user, id);
    const { certificate_content, ...rest } = row;
    return { ...rest, has_certificate: certificate_content !== null };
  }

  /**
   * Part 1 scores. A mock interview is practice, so its candidate sees their own (as in
   * deeptech); for real interviews only the employer will.
   */
  async assessment(user: Actor, id: string) {
    await this.owned(user, id);
    const { rows } = await this.db.query(
      `SELECT status, language, eq_score, resilience_score, grit_score, result, scored_at
         FROM candidate_assessments WHERE interview_type = 'mock' AND interview_ref_id = $1`,
      [id],
    );
    return rows[0] ?? { status: 'pending' };
  }

  async adminList(opts: { status?: string; limit?: number; offset?: number }) {
    await this.markAbandoned();
    const params: unknown[] = [];
    let where = '';
    if (opts.status) {
      params.push(opts.status);
      where = `WHERE m.status = $${params.length}`;
    }
    params.push(Math.min(Math.max(opts.limit ?? 50, 1), 100), Math.max(opts.offset ?? 0, 0));
    const { rows } = await this.db.query(
      `SELECT m.id, m.user_id, u.email, CONCAT_WS(' ', u.first_name, u.last_name) AS candidate_name,
              m.category, m.skill, m.domain, m.status, m.turns, m.started_at, m.completed_at,
              (m.proctoring_summary->>'overall_score')::numeric AS overall_score,
              a.eq_score, a.resilience_score, a.grit_score
         FROM mock_interviews m
         JOIN user_accounts u ON u.id = m.user_id
         LEFT JOIN candidate_assessments a ON a.interview_type = 'mock' AND a.interview_ref_id = m.id::text
         ${where}
        ORDER BY m.started_at DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows;
  }

  // ── Results from deeptech_ai ──────────────────────────────────────────────

  /**
   * Applies one posted result. Every post is recorded first, so one that cannot be applied
   * is kept for inspection. Always resolves: a result the platform cannot use is not
   * something deeptech_ai can fix by retrying.
   */
  async applyResult(event: string, data: AiResultPayload) {
    const refId = String(data?.mock_interview_id ?? data?.interview_ref_id ?? '') || null;
    const { rows } = await this.db.query(
      `INSERT INTO ai_result_events (event, ref_id, payload) VALUES ($1, $2, $3::jsonb) RETURNING id`,
      [event, refId, JSON.stringify({ event, data })],
    );
    const eventId = rows[0].id;

    let error: string | null = null;
    try {
      if (event === EVENT_MOCK_INTERVIEW_COMPLETED) error = await this.applyMockCompleted(data);
      else if (event === EVENT_ASSESSMENT_SCORED) error = await this.applyAssessmentScored(data);
      else error = `unknown event ${event}`;
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
    }

    await this.db.query(`UPDATE ai_result_events SET applied = $2, error = $3 WHERE id = $1`, [
      eventId, error === null, error,
    ]);
    if (error) this.logger.warn(`AI result ${event} (${refId}) not applied: ${error}`);
    return { accepted: true, applied: error === null };
  }

  private async applyMockCompleted(d: AiResultPayload): Promise<string | null> {
    if (!UUID.test(String(d.mock_interview_id ?? ''))) return 'mock_interview_id is not a uuid';
    const turns = Number.isFinite(Number(d.turns)) ? Math.max(0, Math.min(Number(d.turns), 1000)) : 0;
    const res = await this.db.query(
      `UPDATE mock_interviews
          SET status = 'completed',
              conversation = $2::jsonb,
              turns = $3,
              proctoring_summary = $4::jsonb,
              interview_details = $5::jsonb,
              ai_audio_url = $6,
              candidate_audio_url = $7,
              ended_reason = $8,
              completed_at = COALESCE(completed_at, NOW()),
              updated_at = NOW()
        WHERE id = $1`,
      [
        d.mock_interview_id,
        JSON.stringify(Array.isArray(d.conversation) ? d.conversation : []),
        turns,
        JSON.stringify(isObject(d.proctoring_summary) ? d.proctoring_summary : {}),
        JSON.stringify(isObject(d.interview_details) ? d.interview_details : {}),
        typeof d.ai_audio_url === 'string' ? d.ai_audio_url : null,
        typeof d.candidate_audio_url === 'string' ? d.candidate_audio_url : null,
        typeof d.ended_reason === 'string' ? d.ended_reason.slice(0, 40) : null,
      ],
    );
    return res.rowCount ? null : 'no interview with this id';
  }

  private async applyAssessmentScored(d: AiResultPayload): Promise<string | null> {
    const type = String(d.interview_type ?? '');
    const ref = String(d.interview_ref_id ?? '');
    if (!type || !ref) return 'interview_type and interview_ref_id are required';

    // The owner comes from this platform's own record, not from the post.
    let userId: string | null = null;
    if (type === 'mock') {
      if (!UUID.test(ref)) return 'interview_ref_id is not a uuid';
      const { rows } = await this.db.query(`SELECT user_id FROM mock_interviews WHERE id = $1`, [ref]);
      if (!rows.length) return 'no mock interview with this id';
      userId = rows[0].user_id;
    }

    const score = (v: unknown) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
    await this.db.query(
      `INSERT INTO candidate_assessments
         (interview_type, interview_ref_id, user_id, ai_assessment_id, status, language,
          eq_score, resilience_score, grit_score, result, scored_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb,NOW())
       ON CONFLICT (interview_type, interview_ref_id) DO UPDATE SET
         ai_assessment_id = EXCLUDED.ai_assessment_id, status = EXCLUDED.status,
         language = EXCLUDED.language, eq_score = EXCLUDED.eq_score,
         resilience_score = EXCLUDED.resilience_score, grit_score = EXCLUDED.grit_score,
         result = EXCLUDED.result, scored_at = NOW(), updated_at = NOW()`,
      [
        type, ref, userId,
        d.assessment_id ? String(d.assessment_id) : null,
        String(d.status ?? 'scored').slice(0, 32),
        typeof d.language === 'string' ? d.language.slice(0, 8) : null,
        score(d.eq_score), score(d.resilience_score), score(d.grit_score),
        JSON.stringify(isObject(d.result) ? d.result : {}),
      ],
    );
    return null;
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
