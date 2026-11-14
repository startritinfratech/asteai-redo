import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import type { ApplicationStage, HiringKpis } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';

@Injectable()
export class AnalyticsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async getEmployerDashboard(tenantId: string) {
    const [reqs, apps, results] = await Promise.all([
      this.db.query(`SELECT status, COUNT(*) FROM requisitions WHERE tenant_id = $1 GROUP BY status`, [tenantId]),
      this.db.query(`SELECT stage, COUNT(*) FROM applications WHERE tenant_id = $1 GROUP BY stage`, [tenantId]),
      this.db.query(
        `SELECT AVG(fit_score) AS avg_fit, AVG(sten_iq) AS avg_iq,
                AVG(sten_eq) AS avg_eq, AVG(sten_grit) AS avg_grit,
                COUNT(*) AS total
         FROM assessment_results ar
         JOIN applications a ON ar.id = a.result_id
         WHERE a.tenant_id = $1`,
        [tenantId],
      ),
    ]);
    return {
      requisitions:    reqs.rows,
      applicationsByStage: apps.rows,
      assessmentStats: results.rows[0],
    };
  }

  async getFairnessReport(tenantId: string) {
    const { rows } = await this.db.query(
      `SELECT c.lang, COUNT(*) AS total,
              AVG(ar.fit_score) AS avg_fit,
              COUNT(*) FILTER (WHERE a.stage IN ('Shortlisted', 'Interview', 'Offer', 'Joined')) AS shortlisted
       FROM applications a
       JOIN candidates c ON a.candidate_id = c.id
       LEFT JOIN assessment_results ar ON ar.id = a.result_id
       WHERE a.tenant_id = $1
       GROUP BY c.lang`,
      [tenantId],
    );
    return rows;
  }

  /**
   * Live hiring KPIs for the Hire workspace. `tenantId` null = the whole platform (admins).
   * Time to hire uses the Joined entry in each application's stage history.
   */
  async getHiringKpis(tenantId: string | null): Promise<HiringKpis> {
    const scope = (alias: string) => (tenantId ? `${alias}.tenant_id = $1` : 'TRUE');
    const params = tenantId ? [tenantId] : [];
    const [reqs, campaigns, hires, review, stages] = await Promise.all([
      this.db.query<{ open: number; pending: number }>(
        `SELECT COUNT(*) FILTER (WHERE r.status = 'Open')::int AS open,
                COUNT(*) FILTER (WHERE r.approval_status = 'pending')::int AS pending
           FROM requisitions r WHERE ${scope('r')}`, params,
      ),
      this.db.query<{ active: number }>(
        `SELECT COUNT(*)::int AS active FROM outreach_campaigns c WHERE c.status = 'queued' AND ${scope('c')}`, params,
      ),
      this.db.query<{ median_days: string | null; hires: number }>(
        `WITH joined AS (
           SELECT (MAX((h->>'t')::bigint) / 1000.0 - EXTRACT(EPOCH FROM a.created_at)) / 86400 AS days,
                  MAX((h->>'t')::bigint) AS joined_ms
             FROM applications a, jsonb_array_elements(a.history) h
            WHERE a.stage = 'Joined' AND h->>'stage' = 'Joined' AND ${scope('a')}
            GROUP BY a.id, a.created_at
         )
         SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY days) AS median_days, COUNT(*)::int AS hires
           FROM joined WHERE joined_ms > (EXTRACT(EPOCH FROM NOW() - INTERVAL '180 days') * 1000)`, params,
      ),
      this.db.query<{ reviewed: number; matched: number }>(
        `SELECT COUNT(*) FILTER (WHERE a.stage NOT IN ('Applied', 'Eligibility', 'Assessment Pending', 'Assessment Review'))::int AS reviewed,
                COUNT(*) FILTER (WHERE a.stage IN ('Screened', 'Interview', 'Shortlisted', 'Offer', 'Joined'))::int AS matched
           FROM applications a WHERE a.created_at > NOW() - INTERVAL '90 days' AND ${scope('a')}`, params,
      ),
      this.db.query<{ stage: ApplicationStage; n: number }>(
        `SELECT a.stage, COUNT(*)::int AS n FROM applications a WHERE ${scope('a')} GROUP BY a.stage`, params,
      ),
    ]);
    const r = review.rows[0] ?? { reviewed: 0, matched: 0 };
    const median = hires.rows[0]?.median_days;
    return {
      openRequisitions: reqs.rows[0]?.open ?? 0,
      pendingApproval: reqs.rows[0]?.pending ?? 0,
      activeCampaigns: campaigns.rows[0]?.active ?? 0,
      timeToHireDays: median === null || median === undefined ? null : Math.round(Number(median) * 10) / 10,
      hiresLast180Days: hires.rows[0]?.hires ?? 0,
      matchRatePct: r.reviewed ? Math.round((r.matched / r.reviewed) * 1000) / 10 : null,
      reviewedLast90Days: r.reviewed,
      byStage: Object.fromEntries(stages.rows.map((x) => [x.stage, x.n])),
    };
  }
}
