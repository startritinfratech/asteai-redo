import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { randomBytes } from 'crypto';
import { Pool, PoolClient } from 'pg';
import type { CompetencyView, PassportProfile, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { CredentialsService } from '../credentials/credentials.service';
import {
  aggregateCompetency, isValidSlug, overallScore, percentileFromCounts, suggestSlug,
  type EvidenceItem, type EvidenceSource,
} from './scoring';

type Db = Pick<Pool | PoolClient, 'query'>;

export interface EvidenceInput {
  competencyKey: string;
  source: EvidenceSource;
  refId: string;
  /** 0–100 */
  score: number;
}

export type { CompetencyView, PassportProfile };

interface PassportRow {
  user_id: string;
  slug: string;
  headline: string;
  visibility: 'public' | 'private';
  overall_score: string | number | null;
  updated_at: Date;
  holder_name: string | null;
}

const TREND_POINTS = 12;
const n = (v: string | number | null) => (v === null ? null : Number(v));

/**
 * The Verified Talent Passport: one public profile per user (/passports/:slug) whose
 * competency scores come only from evidence the platform produced itself (challenge
 * submissions graded by the runner, scored AI interviews), never from the holder.
 */
@Injectable()
export class TalentPassportService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly credentials: CredentialsService,
  ) {}

  // ── Profile ────────────────────────────────────────────────────────────────

  /** The user's passport row, created (private, with a suggested slug) on first use. */
  async ensure(userId: string, db: Db = this.db): Promise<PassportRow> {
    const existing = await this.row(db, userId);
    if (existing) return existing;
    const { rows } = await db.query<{ name: string }>(
      `SELECT CONCAT_WS(' ', first_name, last_name) AS name FROM user_accounts WHERE id = $1`, [userId],
    );
    for (let attempt = 0; attempt < 5; attempt++) {
      const slug = suggestSlug(rows[0]?.name ?? '', randomBytes(3).toString('hex').slice(0, 4));
      // No conflict target: a taken slug is skipped too (an error would abort the caller's
      // transaction), and the loop tries another suffix.
      await db.query(
        `INSERT INTO talent_passports (user_id, slug) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [userId, slug],
      );
      const row = await this.row(db, userId);
      if (row) return row;
    }
    throw new ConflictException('Could not create a passport address; try again');
  }

  private async row(db: Db, userId: string): Promise<PassportRow | null> {
    const { rows } = await db.query<PassportRow>(
      `SELECT p.*, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS holder_name
         FROM talent_passports p JOIN user_accounts u ON u.id = p.user_id
        WHERE p.user_id = $1`,
      [userId],
    );
    return rows[0] ?? null;
  }

  async getMine(userId: string): Promise<PassportProfile> {
    return this.profile(await this.ensure(userId), true);
  }

  async updateMine(userId: string, patch: { slug?: string; headline?: string; visibility?: 'public' | 'private' }) {
    await this.ensure(userId);
    if (patch.slug !== undefined && !isValidSlug(patch.slug)) {
      throw new BadRequestException('Use 3–40 lowercase letters, digits and single hyphens');
    }
    try {
      await this.db.query(
        `UPDATE talent_passports
            SET slug = COALESCE($2, slug), headline = COALESCE($3, headline),
                visibility = COALESCE($4, visibility), updated_at = NOW()
          WHERE user_id = $1`,
        [userId, patch.slug ?? null, patch.headline?.trim() ?? null, patch.visibility ?? null],
      );
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('That address is taken');
      throw err;
    }
    return this.getMine(userId);
  }

  /** GET /passports/:slug. A private passport is visible only to its holder and admins. */
  async bySlug(slug: string, viewer: Pick<User, 'id' | 'role'> | null): Promise<PassportProfile> {
    const { rows } = await this.db.query<PassportRow>(
      `SELECT p.*, NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS holder_name
         FROM talent_passports p JOIN user_accounts u ON u.id = p.user_id
        WHERE p.slug = $1 AND u.deleted_at IS NULL`,
      [slug.toLowerCase()],
    );
    const row = rows[0];
    const isOwner = !!viewer && (viewer.id === row?.user_id || viewer.role === 'Admin');
    if (!row || (row.visibility !== 'public' && !isOwner)) throw new NotFoundException('Passport not found');
    return this.profile(row, isOwner);
  }

  async benchmarks() {
    const { rows } = await this.db.query(
      `SELECT b.key, b.label, b.category, b.description,
              COUNT(s.user_id)::int AS holders,
              ROUND(AVG(s.score), 1) AS mean_score,
              PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY s.score) AS median_score,
              PERCENTILE_CONT(0.9) WITHIN GROUP (ORDER BY s.score) AS p90_score
         FROM competency_benchmarks b
         LEFT JOIN competency_scores s ON s.competency_key = b.key
        GROUP BY b.key ORDER BY MIN(b.sort)`,
    );
    return rows.map((r) => ({
      key: r.key, label: r.label, category: r.category, description: r.description, holders: r.holders,
      meanScore: n(r.mean_score), medianScore: n(r.median_score), p90Score: n(r.p90_score),
    }));
  }

  private async profile(row: PassportRow, includePrivate: boolean): Promise<PassportProfile> {
    const userId = row.user_id;
    const [competencies, trend, overallRank, creds] = await Promise.all([
      this.db.query(
        `SELECT cs.competency_key AS key, cb.label, cb.category, cs.score, cs.confidence, cs.evidence_count,
                cs.updated_at, r.below, r.equal, r.others
           FROM competency_scores cs
           JOIN competency_benchmarks cb ON cb.key = cs.competency_key
           CROSS JOIN LATERAL (
             SELECT COUNT(*) FILTER (WHERE o.score < cs.score)::int AS below,
                    COUNT(*) FILTER (WHERE o.score = cs.score)::int AS equal,
                    COUNT(*)::int AS others
               FROM competency_scores o
              WHERE o.competency_key = cs.competency_key AND o.user_id <> cs.user_id
           ) r
          WHERE cs.user_id = $1
          ORDER BY cb.sort`,
        [userId],
      ),
      this.db.query(
        `SELECT competency_key, score_after, percentile_after, created_at FROM competency_evidence
          WHERE user_id = $1 AND score_after IS NOT NULL ORDER BY created_at DESC LIMIT 300`,
        [userId],
      ),
      row.overall_score === null ? Promise.resolve({ rows: [] }) : this.db.query(
        `SELECT COUNT(*) FILTER (WHERE overall_score < $2)::int AS below,
                COUNT(*) FILTER (WHERE overall_score = $2)::int AS equal,
                COUNT(*)::int AS others
           FROM talent_passports WHERE user_id <> $1 AND overall_score IS NOT NULL`,
        [userId, row.overall_score],
      ),
      this.db.query(
        `SELECT code, kind, issued_at FROM credentials
          WHERE user_id = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > NOW())
            ${includePrivate ? '' : `AND kind <> 'passport_snapshot'`}
          ORDER BY issued_at DESC LIMIT 20`,
        [userId],
      ),
    ]);

    const trendBy = new Map<string, CompetencyView['trend']>();
    for (const t of [...trend.rows].reverse()) {
      const list = trendBy.get(t.competency_key) ?? [];
      list.push({ at: new Date(t.created_at).toISOString(), score: Number(t.score_after), percentile: n(t.percentile_after) });
      trendBy.set(t.competency_key, list.slice(-TREND_POINTS));
    }
    const rank = overallRank.rows[0] as { below: number; equal: number; others: number } | undefined;

    return {
      slug: row.slug,
      holderName: row.holder_name ?? 'AsteAI member',
      headline: row.headline,
      visibility: row.visibility,
      overall: {
        score: n(row.overall_score),
        percentile: rank ? percentileFromCounts(rank.below, rank.equal, rank.others) : null,
      },
      competencies: competencies.rows.map((c) => ({
        key: c.key,
        label: c.label,
        category: c.category,
        score: Number(c.score),
        confidence: Number(c.confidence),
        evidenceCount: Number(c.evidence_count),
        percentile: percentileFromCounts(c.below, c.equal, c.others),
        trend: trendBy.get(c.key) ?? [],
        updatedAt: new Date(c.updated_at).toISOString(),
      })),
      credentials: creds.rows.map((c) => ({
        code: c.code, kind: c.kind, issuedAt: new Date(c.issued_at).toISOString(), verifyPath: `/verify/${c.code}`,
      })),
      updatedAt: new Date(row.updated_at).toISOString(),
    };
  }

  // ── Scoring ────────────────────────────────────────────────────────────────

  /**
   * Adds platform-produced evidence and recomputes the affected competencies, their
   * percentiles and the overall score, all in one transaction with the passport row
   * locked (so two finishing submissions of one user can't interleave). Pass `client` to
   * join the caller's transaction.
   */
  async recordEvidence(userId: string, items: readonly EvidenceInput[], client?: PoolClient) {
    const run = async (c: Db) => {
      await this.ensure(userId, c);
      await c.query(`SELECT 1 FROM talent_passports WHERE user_id = $1 FOR UPDATE`, [userId]);

      const updated: { key: string; score: number; percentile: number | null }[] = [];
      for (const item of items) {
        const score = Math.min(100, Math.max(0, Number(item.score)));
        if (!Number.isFinite(score)) continue;
        const inserted = await c.query<{ id: string }>(
          `INSERT INTO competency_evidence (user_id, competency_key, source, ref_id, score)
           VALUES ($1, $2, $3, $4, $5) RETURNING id`,
          [userId, item.competencyKey, item.source, item.refId, score],
        );
        const { rows: all } = await c.query<{ source: EvidenceSource; ref_id: string; score: string | number }>(
          `SELECT source, ref_id, score FROM competency_evidence WHERE user_id = $1 AND competency_key = $2`,
          [userId, item.competencyKey],
        );
        const agg = aggregateCompetency(all.map((e): EvidenceItem => ({ source: e.source, refId: e.ref_id, score: Number(e.score) })));
        if (!agg) continue;
        await c.query(
          `INSERT INTO competency_scores (user_id, competency_key, score, confidence, evidence_count, updated_at)
           VALUES ($1, $2, $3, $4, $5, NOW())
           ON CONFLICT (user_id, competency_key) DO UPDATE SET
             score = EXCLUDED.score, confidence = EXCLUDED.confidence,
             evidence_count = EXCLUDED.evidence_count, updated_at = NOW()`,
          [userId, item.competencyKey, agg.score, agg.confidence, agg.evidenceCount],
        );
        const { rows: rank } = await c.query<{ below: number; equal: number; others: number }>(
          `SELECT COUNT(*) FILTER (WHERE score < $3)::int AS below,
                  COUNT(*) FILTER (WHERE score = $3)::int AS equal,
                  COUNT(*)::int AS others
             FROM competency_scores WHERE competency_key = $1 AND user_id <> $2`,
          [item.competencyKey, userId, agg.score],
        );
        const percentile = rank[0] ? percentileFromCounts(rank[0].below, rank[0].equal, rank[0].others) : null;
        await c.query(
          `UPDATE competency_evidence SET score_after = $2, percentile_after = $3 WHERE id = $1`,
          [inserted.rows[0].id, agg.score, percentile],
        );
        updated.push({ key: item.competencyKey, score: agg.score, percentile });
      }

      const { rows: scores } = await c.query<{ score: string | number; confidence: string | number }>(
        `SELECT score, confidence FROM competency_scores WHERE user_id = $1`, [userId],
      );
      const overall = overallScore(scores.map((s) => ({ score: Number(s.score), confidence: Number(s.confidence) })));
      await c.query(
        `UPDATE talent_passports SET overall_score = $2, updated_at = NOW() WHERE user_id = $1`, [userId, overall],
      );
      return { overallScore: overall, competencies: updated };
    };
    return client ? run(client) : withTransaction(this.db, run);
  }

  /** Signs what the passport says right now; the holder shares the code. */
  async issueSnapshot(userId: string) {
    const profile = await this.getMine(userId);
    if (!profile.competencies.length) throw new BadRequestException('Earn at least one competency score first');
    return this.credentials.issue(userId, 'passport_snapshot', {
      holderName: profile.holderName,
      passportSlug: profile.slug,
      overallScore: profile.overall.score,
      overallPercentile: profile.overall.percentile,
      competencies: profile.competencies.map((c) => ({
        key: c.key, label: c.label, score: c.score, percentile: c.percentile, evidenceCount: c.evidenceCount,
      })),
    }, { validForDays: 365 });
  }
}
