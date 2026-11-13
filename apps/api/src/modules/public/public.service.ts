import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool } from 'pg';
import type {
  CreditCost, Plan, PlanAudience, PublicCreditSettings, PublicJob, PublicJobPage, PublicStats,
} from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import {
  buildJobFilters, decodeCursor, encodeCursor, mapPublicJob, PUBLIC_JOB_SELECT, PUBLIC_JOB_WHERE,
  type JobFilters, type PublicJobRow,
} from './job-board';

interface PlanRow {
  id: string; audience: PlanAudience; name: string; tagline: string; price_minor: number | null; currency: string;
  interval: 'month' | 'year'; monthly_credits: number; features: string[]; highlighted: boolean;
}

const asNumber = (v: unknown, fallback: number) => (typeof v === 'number' && Number.isFinite(v) ? v : fallback);

/** Read-only data for signed-out pages. Every response here is safe to cache at the edge. */
@Injectable()
export class PublicService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async listJobs(filters: JobFilters, limit = 20, rawCursor?: string): Promise<PublicJobPage> {
    const { where, params } = buildJobFilters(filters);
    const cursor = decodeCursor(rawCursor);
    const pageParams = [...params];
    let keyset = '';
    if (cursor) {
      pageParams.push(cursor.publishedAt, cursor.id);
      keyset = ` AND (r.published_at, r.id) < ($${pageParams.length - 1}::timestamptz, $${pageParams.length})`;
    }
    pageParams.push(limit + 1);

    const [page, count] = await Promise.all([
      this.db.query<PublicJobRow>(
        `SELECT ${PUBLIC_JOB_SELECT}
           FROM requisitions r JOIN tenants t ON t.id = r.tenant_id
          WHERE ${where}${keyset}
          ORDER BY r.published_at DESC, r.id DESC
          LIMIT $${pageParams.length}`,
        pageParams,
      ),
      this.db.query<{ total: number }>(
        `SELECT COUNT(*)::int AS total FROM requisitions r JOIN tenants t ON t.id = r.tenant_id WHERE ${where}`,
        params,
      ),
    ]);

    const rows = page.rows.slice(0, limit);
    const last = rows[rows.length - 1];
    return {
      items: rows.map(mapPublicJob),
      total: count.rows[0]?.total ?? 0,
      nextCursor: page.rows.length > limit && last ? encodeCursor({ publishedAt: last.published_at.toISOString(), id: last.id }) : null,
    };
  }

  /** 404 for anything not currently on the board (draft, closed, private, expired, test tenant). */
  async getJob(id: string): Promise<PublicJob> {
    const { rows } = await this.db.query<PublicJobRow>(
      `SELECT ${PUBLIC_JOB_SELECT} FROM requisitions r JOIN tenants t ON t.id = r.tenant_id
        WHERE r.id = $1 AND ${PUBLIC_JOB_WHERE}`,
      [id],
    );
    if (!rows.length) throw new NotFoundException('Job not found');
    return mapPublicJob(rows[0]);
  }

  async plans(audience?: PlanAudience): Promise<Plan[]> {
    const { rows } = await this.db.query<PlanRow>(
      `SELECT id, audience, name, tagline, price_minor, currency, interval, monthly_credits, features, highlighted
         FROM plans WHERE is_active AND ($1::text IS NULL OR audience = $1) ORDER BY audience, sort`,
      [audience ?? null],
    );
    return rows.map((r) => ({
      id: r.id, audience: r.audience, name: r.name, tagline: r.tagline, priceMinor: r.price_minor, currency: r.currency,
      interval: r.interval, monthlyCredits: r.monthly_credits, features: r.features, highlighted: r.highlighted,
    }));
  }

  async creditSettings(): Promise<PublicCreditSettings> {
    const [settings, costs] = await Promise.all([
      this.db.query<{ key: string; value: unknown }>(`SELECT key, value FROM platform_settings`),
      this.db.query<{ feature: string; label: string; cost: number; cost_max: number | null }>(
        `SELECT feature, label, cost, cost_max FROM credit_costs ORDER BY sort, feature`,
      ),
    ]);
    const s = new Map(settings.rows.map((r) => [r.key, r.value]));
    const tiers = s.get('proposal_budget_tiers');
    return {
      welcomeBonusCredits: asNumber(s.get('welcome_bonus_credits'), 0),
      referralBonusCredits: asNumber(s.get('referral_bonus_credits'), 0),
      maxReferralsPerUser: asNumber(s.get('max_referrals_per_user'), 0),
      proposalBudgetTiers: Array.isArray(tiers) ? tiers.filter((t): t is number => typeof t === 'number') : [],
      costs: costs.rows.map((c): CreditCost => ({ feature: c.feature, label: c.label, cost: c.cost, costMax: c.cost_max })),
    };
  }

  /** Marketing counters. Counts only what is publicly visible, never user totals. */
  async stats(): Promise<PublicStats> {
    const { rows } = await this.db.query<{ experts: number; jobs: number; projects: number; services: number; completed: number }>(
      `SELECT
         (SELECT COUNT(*) FROM expert_profiles WHERE status = 'approved')::int AS experts,
         (SELECT COUNT(*) FROM requisitions r JOIN tenants t ON t.id = r.tenant_id WHERE ${PUBLIC_JOB_WHERE})::int AS jobs,
         (SELECT COUNT(*) FROM projects WHERE stage = 'Open for Bids')::int AS projects,
         (SELECT COUNT(*) FROM services WHERE status = 'published')::int AS services,
         (SELECT COUNT(*) FROM contracts WHERE status = 'completed')::int AS completed`,
    );
    const r = rows[0];
    return {
      verifiedExperts: r?.experts ?? 0, openJobs: r?.jobs ?? 0, openProjects: r?.projects ?? 0,
      publishedServices: r?.services ?? 0, completedContracts: r?.completed ?? 0,
    };
  }
}
