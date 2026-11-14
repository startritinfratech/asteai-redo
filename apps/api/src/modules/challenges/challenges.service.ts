import {
  BadGatewayException, BadRequestException, ConflictException, HttpException, HttpStatus, Inject, Injectable, Logger,
  NotFoundException, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { SubmissionResult } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { CredentialsService, type IssuedCredential } from '../credentials/credentials.service';
import { TalentPassportService } from '../passports/talent-passport.service';
import { CHALLENGE_LANGUAGES, CODE_RUNNER, type ChallengeLanguage, type CodeRunner } from './code-runner';
import { grade, outcomeOf, sanitizeTelemetry, type TestCase, type TestOutcome } from './grading';

/** Most submissions one user may make in an hour, across all challenges. */
export const SUBMISSIONS_PER_HOUR = 30;
/** A "running" submission older than this died with its request; it no longer blocks. */
const STALE_RUNNING = '5 minutes';
const MAX_TESTS = 25;

interface ChallengeRow {
  id: string;
  title: string;
  prompt: string;
  difficulty: 'easy' | 'medium' | 'hard';
  competency_key: string;
  languages: string[];
  starter: Record<string, string>;
  examples: TestCase[];
  tests: TestCase[];
  time_limit_ms: number;
  memory_limit_kb: number;
}

export type { SubmissionResult };

@Injectable()
export class ChallengesService {
  private readonly logger = new Logger(ChallengesService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly passports: TalentPassportService,
    private readonly credentials: CredentialsService,
    @Optional() @Inject(CODE_RUNNER) private readonly runner: CodeRunner | null,
  ) {}

  /** Active challenges (never the hidden tests), with the caller's best score when signed in. */
  async list(userId?: string) {
    const { rows } = await this.db.query(
      `SELECT c.id, c.title, c.difficulty, c.competency_key, c.languages,
              jsonb_array_length(c.tests) AS test_count,
              ${userId ? `(SELECT MAX(s.score) FROM challenge_submissions s WHERE s.challenge_id = c.id AND s.user_id = $1)` : 'NULL'} AS best_score
         FROM code_challenges c WHERE c.is_active ORDER BY c.sort, c.id`,
      userId ? [userId] : [],
    );
    return rows.map((r) => ({
      id: r.id, title: r.title, difficulty: r.difficulty, competency: r.competency_key, languages: r.languages,
      testCount: Number(r.test_count), bestScore: r.best_score === null ? null : Number(r.best_score),
    }));
  }

  async get(id: string) {
    const c = await this.load(id);
    return {
      id: c.id, title: c.title, prompt: c.prompt, difficulty: c.difficulty, competency: c.competency_key,
      languages: c.languages, starter: c.starter, examples: c.examples, testCount: c.tests.length,
      timeLimitMs: c.time_limit_ms, memoryLimitKb: c.memory_limit_kb,
    };
  }

  private async load(id: string): Promise<ChallengeRow> {
    const { rows } = await this.db.query<ChallengeRow>(`SELECT * FROM code_challenges WHERE id = $1 AND is_active`, [id]);
    if (!rows.length) throw new NotFoundException('Challenge not found');
    return rows[0];
  }

  async mySubmissions(userId: string, challengeId: string) {
    const { rows } = await this.db.query(
      `SELECT id, language, status, passed_tests, total_tests, score, max_runtime_ms, max_memory_kb, created_at, finished_at
         FROM challenge_submissions WHERE user_id = $1 AND challenge_id = $2 ORDER BY created_at DESC LIMIT 50`,
      [userId, challengeId],
    );
    return rows;
  }

  /**
   * Grades a solution against every test. Limits: SUBMISSIONS_PER_HOUR per user (429),
   * one running submission per user at a time (409), plus the route's throttle. Tests run
   * outside any transaction; the result, the passport update and any credential are then
   * written together.
   */
  async submit(
    userId: string, challengeId: string, input: { language: string; source: string; telemetry?: unknown },
  ): Promise<SubmissionResult> {
    if (!this.runner) throw new ServiceUnavailableException('Code challenges are not configured (JUDGE0_URL)');
    const challenge = await this.load(challengeId);
    if (!(CHALLENGE_LANGUAGES as readonly string[]).includes(input.language) || !challenge.languages.includes(input.language)) {
      throw new BadRequestException(`This challenge accepts ${challenge.languages.join(', ')}`);
    }
    const language = input.language as ChallengeLanguage;
    const tests = challenge.tests.slice(0, MAX_TESTS);
    if (!tests.length) throw new ServiceUnavailableException('This challenge has no tests yet');

    await this.db.query(
      `UPDATE challenge_submissions SET status = 'error', finished_at = NOW()
        WHERE user_id = $1 AND status = 'running' AND created_at < NOW() - INTERVAL '${STALE_RUNNING}'`,
      [userId],
    );
    const { rows: recent } = await this.db.query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM challenge_submissions WHERE user_id = $1 AND created_at > NOW() - INTERVAL '1 hour'`,
      [userId],
    );
    if ((recent[0]?.n ?? 0) >= SUBMISSIONS_PER_HOUR) {
      throw new HttpException(`At most ${SUBMISSIONS_PER_HOUR} submissions an hour. Try again later.`, HttpStatus.TOO_MANY_REQUESTS);
    }

    const clientTelemetry = sanitizeTelemetry(input.telemetry);
    let submissionId: string;
    try {
      const { rows } = await this.db.query<{ id: string }>(
        `INSERT INTO challenge_submissions (challenge_id, user_id, language, source, total_tests, telemetry)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING id`,
        [challenge.id, userId, language, input.source, tests.length, JSON.stringify({ client: clientTelemetry })],
      );
      submissionId = rows[0].id;
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('Your previous submission is still running');
      throw err;
    }

    // ── Run ──
    const started = Date.now();
    const outcomes: TestOutcome[] = [];
    let compileOutput: string | null = null;
    let runnerFailed = false;
    for (let i = 0; i < tests.length; i++) {
      const run = await this.runner.run({
        language, source: input.source, stdin: tests[i].stdin,
        timeLimitMs: challenge.time_limit_ms, memoryLimitKb: challenge.memory_limit_kb,
      });
      if (run.status === 'internal_error') {
        runnerFailed = true;
        break;
      }
      outcomes.push(outcomeOf(i, tests[i], run));
      if (run.status === 'compile_error') {
        // Same source, same result on every test: don't run the rest.
        compileOutput = run.diagnostics;
        for (let j = i + 1; j < tests.length; j++) {
          outcomes.push({ index: j, passed: false, status: 'skipped', timeMs: null, memoryKb: null });
        }
        break;
      }
    }

    if (runnerFailed) {
      await this.db.query(
        `UPDATE challenge_submissions SET status = 'error', finished_at = NOW(),
                telemetry = telemetry || jsonb_build_object('runner', 'unavailable') WHERE id = $1`,
        [submissionId],
      );
      throw new BadGatewayException('The code runner is unavailable. This attempt was not counted.');
    }

    const g = grade(outcomes, tests.length);
    const runnerTelemetry = { wallMs: Date.now() - started, tests: outcomes, compileOutput };

    return withTransaction(this.db, async (client) => {
      await client.query(
        `UPDATE challenge_submissions
            SET status = $2, passed_tests = $3, score = $4, max_runtime_ms = $5, max_memory_kb = $6,
                telemetry = telemetry || jsonb_build_object('runner', $7::jsonb), finished_at = NOW()
          WHERE id = $1`,
        [submissionId, g.status, g.passedTests, g.score, g.maxRuntimeMs, g.maxMemoryKb, JSON.stringify(runnerTelemetry)],
      );

      const updated = await this.passports.recordEvidence(userId, [
        { competencyKey: challenge.competency_key, source: 'challenge', refId: challenge.id, score: g.score },
      ], client);

      let credential: IssuedCredential | null = null;
      if (g.status === 'passed') {
        const { rows: earlier } = await client.query(
          `SELECT 1 FROM challenge_submissions
            WHERE user_id = $1 AND challenge_id = $2 AND status = 'passed' AND id <> $3 LIMIT 1`,
          [userId, challenge.id, submissionId],
        );
        if (!earlier.length) {
          credential = await this.credentials.issue(userId, 'challenge', {
            challengeId: challenge.id, challengeTitle: challenge.title, difficulty: challenge.difficulty,
            competency: challenge.competency_key, language, score: g.score, tests: g.totalTests,
            submissionId,
          }, { db: client });
        }
      }

      const exampleCount = challenge.examples.length;
      const competency = updated.competencies[0];
      return {
        submissionId,
        status: g.status,
        passedTests: g.passedTests,
        totalTests: g.totalTests,
        score: g.score,
        maxRuntimeMs: g.maxRuntimeMs,
        maxMemoryKb: g.maxMemoryKb,
        // code_challenges.tests lists the published examples first, then the hidden ones.
        tests: outcomes.map((o) => ({ ...o, example: o.index < exampleCount })),
        compileOutput,
        passport: competency ? { competency: competency.key, score: competency.score, percentile: competency.percentile } : null,
        credential,
      };
    });
  }
}
