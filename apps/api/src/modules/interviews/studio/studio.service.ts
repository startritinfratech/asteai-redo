import {
  BadGatewayException, BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable,
  Logger, NotFoundException, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { StudioCompletion, StudioRubricResult, StudioTurnResponse, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../../database/database.module';
import { CredentialsService } from '../../credentials/credentials.service';
import { TalentPassportService } from '../../passports/talent-passport.service';
import { domainsFor, findFrontlineRole, INTERVIEW_LANGUAGES } from '../catalogue';
import { INTERVIEW_MODEL, type InterviewContext, type InterviewModel, type TranscriptTurn } from './interview-model';
import { RUBRICS, type InterviewMode } from './rubrics';
import { InvalidModelScoresError, scoreRubric, type RubricResult } from './scoring';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface SessionRow {
  id: string;
  user_id: string;
  mode: InterviewMode;
  domain: string;
  skill: string;
  frontline_role_id: string | null;
  language: string;
  status: 'active' | 'completed' | 'abandoned';
  transcript: TranscriptTurn[];
  question_count: number;
  rubric_result: StoredResult | null;
  credential_code: string | null;
  expires_at: Date;
}

/** What is stored and returned: the computed rubric plus the model's written feedback. */
export type StoredResult = StudioRubricResult;

export interface StartInput {
  mode: InterviewMode;
  domain: string;
  skill: string;
  language?: string;
}

export interface TurnInput {
  answer: string;
  inputMode: 'text' | 'voice';
  /** Language the speech recogniser detected, if different from the session's. */
  detectedLanguage?: string;
  speech?: { durationMs?: number; confidence?: number };
}

export type TurnResponse = StudioTurnResponse;
export type CompletionResponse = StudioCompletion;

const answersIn = (t: readonly TranscriptTurn[]) => t.filter((x) => x.role === 'candidate').length;

/**
 * AI Interview Studio over plain request/response turns:
 *   start → question 1; turn(answer) → next question … ; complete → rubric scores.
 * `technical` is a text (or voice) rubric interview; `trades_voice` is voice-only and
 * multilingual for railway and trades roles: the browser does speech-to-text and reads
 * `prompt.text` aloud, this API works on transcripts.
 */
@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly passports: TalentPassportService,
    private readonly credentials: CredentialsService,
    @Optional() @Inject(INTERVIEW_MODEL) private readonly model: InterviewModel | null,
  ) {}

  private requireModel(): InterviewModel {
    if (!this.model) throw new ServiceUnavailableException('AI interviews are not configured (ANTHROPIC_API_KEY is not set)');
    return this.model;
  }

  private context(row: Pick<SessionRow, 'mode' | 'domain' | 'skill' | 'language'>, transcript: readonly TranscriptTurn[]): InterviewContext {
    const rubric = RUBRICS[row.mode];
    return {
      mode: row.mode, domain: row.domain, skill: row.skill, language: row.language,
      languageLabel: INTERVIEW_LANGUAGES.find((l) => l.code === row.language)?.label ?? row.language,
      transcript, questionNumber: transcript.filter((t) => t.role === 'interviewer').length + 1, maxQuestions: rubric.maxQuestions,
    };
  }

  private response(row: Pick<SessionRow, 'id' | 'mode' | 'language'>, transcript: readonly TranscriptTurn[]): TurnResponse {
    const rubric = RUBRICS[row.mode];
    const last = transcript[transcript.length - 1];
    const answers = answersIn(transcript);
    return {
      sessionId: row.id,
      mode: row.mode,
      language: row.language,
      status: 'active',
      questionNumber: transcript.filter((t) => t.role === 'interviewer').length,
      maxQuestions: rubric.maxQuestions,
      answersGiven: answers,
      prompt: last?.role === 'interviewer' ? { text: last.text, language: row.language, speak: row.mode === 'trades_voice' } : null,
      canComplete: answers >= rubric.minAnswersToScore,
    };
  }

  // ── Start ──────────────────────────────────────────────────────────────────

  /** Validates the setup, asks question 1, stores the session. `creditSpendId` from the credit interceptor. */
  async start(user: Pick<User, 'id'>, input: StartInput, creditSpendId: string | null): Promise<TurnResponse> {
    const model = this.requireModel();
    const domain = input.domain.trim();
    const skill = input.skill.trim();
    const language = input.language ?? 'en';
    if (!INTERVIEW_LANGUAGES.some((l) => l.code === language)) throw new BadRequestException(`Unsupported language "${language}"`);

    let frontlineRoleId: string | null = null;
    if (input.mode === 'trades_voice') {
      const role = findFrontlineRole(domain, skill);
      if (!role) throw new BadRequestException(`"${skill}" is not a role in "${domain}"`);
      frontlineRoleId = role.roleId;
    } else if (!domainsFor('tech').includes(domain)) {
      throw new BadRequestException(`"${domain}" is not a technical field`);
    }
    if (!skill || skill.length > 120) throw new BadRequestException('Name the skill or role (up to 120 characters)');

    const base = { mode: input.mode, domain, skill, language };
    const question = await model.nextQuestion(this.context(base, []));
    const transcript: TranscriptTurn[] = [{ role: 'interviewer', text: question, at: new Date().toISOString() }];

    const { rows } = await this.db.query<{ id: string }>(
      `INSERT INTO interview_sessions
         (user_id, mode, domain, skill, frontline_role_id, language, transcript, question_count, credit_spend_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 1, $8) RETURNING id`,
      [user.id, input.mode, domain, skill, frontlineRoleId, language, JSON.stringify(transcript), creditSpendId],
    );
    return this.response({ id: rows[0].id, mode: input.mode, language }, transcript);
  }

  // ── Turn ───────────────────────────────────────────────────────────────────

  async turn(user: Pick<User, 'id'>, id: string, input: TurnInput): Promise<TurnResponse> {
    const row = await this.activeOwned(user, id);
    const rubric = RUBRICS[row.mode];
    if (row.mode === 'trades_voice' && input.inputMode !== 'voice') {
      throw new BadRequestException('This is a voice interview: answer by speaking');
    }
    const transcript = [...row.transcript];
    if (transcript[transcript.length - 1]?.role !== 'interviewer') {
      throw new ConflictException('No question is waiting for an answer; complete the interview');
    }
    const answer = input.answer.trim();
    if (!answer) throw new BadRequestException('The answer is empty');

    transcript.push({
      role: 'candidate',
      text: answer.slice(0, 4000),
      at: new Date().toISOString(),
      meta: {
        inputMode: input.inputMode,
        ...(input.detectedLanguage ? { detectedLanguage: input.detectedLanguage.slice(0, 8) } : {}),
        ...(input.speech ? { speech: sanitizeSpeech(input.speech) } : {}),
      },
    });
    if (answersIn(transcript) < rubric.maxQuestions) {
      const question = await this.requireModel().nextQuestion(this.context(row, transcript));
      transcript.push({ role: 'interviewer', text: question, at: new Date().toISOString() });
    }

    // Optimistic: a concurrent turn on the same session already moved it on.
    const { rowCount } = await this.db.query(
      `UPDATE interview_sessions SET transcript = $3::jsonb, question_count = $4, updated_at = NOW()
        WHERE id = $1 AND status = 'active' AND question_count = $2`,
      [row.id, row.question_count, JSON.stringify(transcript), transcript.filter((t) => t.role === 'interviewer').length],
    );
    if (!rowCount) throw new ConflictException('This interview moved on in another window; reload it');
    return this.response(row, transcript);
  }

  // ── Complete ───────────────────────────────────────────────────────────────

  /**
   * Scores the transcript against the rubric, updates the Talent Passport and issues a
   * signed credential. Idempotent: a completed session returns its stored result.
   */
  async complete(user: Pick<User, 'id'>, id: string): Promise<CompletionResponse> {
    const row = await this.owned(user, id);
    if (row.status === 'completed' && row.rubric_result) {
      return { sessionId: row.id, status: 'completed', mode: row.mode, rubric: row.rubric_result, passport: null, credential: null };
    }
    if (row.status !== 'active') throw new GoneException('This interview has ended');
    const rubric = RUBRICS[row.mode];
    if (answersIn(row.transcript) < rubric.minAnswersToScore) {
      throw new ConflictException(`Answer at least ${rubric.minAnswersToScore} questions before finishing`);
    }

    const assessment = await this.requireModel().assess(this.context(row, row.transcript));
    let result: RubricResult;
    try {
      result = scoreRubric(rubric, assessment.criteria);
    } catch (err) {
      if (err instanceof InvalidModelScoresError) {
        this.logger.warn(`Interview ${row.id}: unusable scores (${err.message})`);
        throw new BadGatewayException('Scoring did not complete; try finishing again');
      }
      throw err;
    }
    const stored: StoredResult = { ...result, summary: assessment.summary, strengths: assessment.strengths, improvements: assessment.improvements };

    return withTransaction(this.db, async (client) => {
      const { rowCount } = await client.query(
        `UPDATE interview_sessions
            SET status = 'completed', rubric_result = $2::jsonb, overall_score = $3, recommendation = $4,
                completed_at = NOW(), updated_at = NOW()
          WHERE id = $1 AND status = 'active'`,
        [row.id, JSON.stringify(stored), stored.overall, stored.recommendation],
      );
      if (!rowCount) throw new ConflictException('This interview was already completed');

      // A competency fed by more than one criterion (none today) gets their mean.
      const byCompetency = new Map<string, number[]>();
      for (const c of stored.criteria) byCompetency.set(c.competency, [...(byCompetency.get(c.competency) ?? []), c.normalized]);
      const passport = await this.passports.recordEvidence(user.id, [...byCompetency].map(([competencyKey, xs]) => ({
        competencyKey, source: 'interview' as const, refId: row.id, score: xs.reduce((a, b) => a + b, 0) / xs.length,
      })), client);

      const credential = await this.credentials.issue(user.id, 'interview', {
        sessionId: row.id,
        mode: row.mode,
        domain: row.domain,
        role: row.skill,
        language: row.language,
        overallScore: stored.overall,
        recommendation: stored.recommendation,
        criteria: stored.criteria.map((c) => ({ key: c.key, label: c.label, score: c.score })),
      }, { validForDays: 730, db: client });
      await client.query(`UPDATE interview_sessions SET credential_code = $2 WHERE id = $1`, [row.id, credential.code]);

      return { sessionId: row.id, status: 'completed' as const, mode: row.mode, rubric: stored, passport, credential };
    });
  }

  // ── Reading ────────────────────────────────────────────────────────────────

  async get(user: Pick<User, 'id' | 'role'>, id: string) {
    const row = await this.owned(user, id);
    return {
      sessionId: row.id, mode: row.mode, domain: row.domain, skill: row.skill, language: row.language,
      status: row.status, transcript: row.transcript, rubric: row.rubric_result, credentialCode: row.credential_code,
    };
  }

  private async owned(user: Pick<User, 'id'> & { role?: string }, id: string): Promise<SessionRow> {
    if (!UUID.test(id)) throw new NotFoundException('Interview not found');
    const { rows } = await this.db.query<SessionRow>(`SELECT * FROM interview_sessions WHERE id = $1`, [id]);
    const row = rows[0];
    if (!row) throw new NotFoundException('Interview not found');
    if (row.user_id !== user.id && user.role !== 'Admin') throw new ForbiddenException();
    return row;
  }

  private async activeOwned(user: Pick<User, 'id'>, id: string): Promise<SessionRow> {
    const row = await this.owned(user, id);
    if (row.user_id !== user.id) throw new ForbiddenException();
    if (row.status !== 'active') throw new GoneException('This interview has ended');
    if (new Date(row.expires_at).getTime() < Date.now()) {
      await this.db.query(
        `UPDATE interview_sessions SET status = 'abandoned', updated_at = NOW() WHERE id = $1 AND status = 'active'`, [row.id],
      );
      throw new GoneException('This interview timed out');
    }
    return row;
  }
}

function sanitizeSpeech(s: { durationMs?: number; confidence?: number }) {
  const out: { durationMs?: number; confidence?: number } = {};
  if (typeof s.durationMs === 'number' && Number.isFinite(s.durationMs)) out.durationMs = Math.max(0, Math.min(Math.round(s.durationMs), 600_000));
  if (typeof s.confidence === 'number' && Number.isFinite(s.confidence)) out.confidence = Math.max(0, Math.min(s.confidence, 1));
  return out;
}
