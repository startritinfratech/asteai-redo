'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { fourFifthsReport, type ImpactStatus } from '@/lib/fairness';
import { Empty, KPI, PageHeader, Panel, Tag, type TagColor } from '@/components/ui';

const STATUS_COLOR: Record<ImpactStatus, TagColor> = { Pass: 'mint', Review: 'amber', 'No data': 'grey' };
const OVERALL_LABEL: Record<ImpactStatus, string> = {
  Pass: 'Pass: no group below 4/5ths',
  Review: 'Review: adverse impact detected',
  'No data': 'Not enough data',
};

interface DashboardStats {
  requisitions?: { status: string; count: string }[];
  applicationsByStage?: { stage: string; count: string }[];
  assessmentStats?: {
    avg_fit?: string;
    avg_iq?: string;
    avg_eq?: string;
    avg_grit?: string;
    total?: string;
  };
}

interface FairnessRow {
  lang: string;
  total: string;
  avg_fit: string;
  shortlisted: string;
}

export default function AnalyticsPage() {
  const { data: dash, error: dashError, isLoading: dashLoading } = useSWR<DashboardStats>(
    '/analytics/employer/dashboard',
    fetcher,
  );
  const { data: fairness, error: fairError, isLoading: fairLoading } = useSWR<FairnessRow[]>(
    '/analytics/employer/fairness',
    fetcher,
  );

  const report = fourFifthsReport(
    (fairness ?? []).map((row) => ({
      group: row.lang || 'English (Default)',
      total: Number(row.total),
      selected: Number(row.shortlisted),
    })),
  );
  const avgFitByGroup = new Map((fairness ?? []).map((row) => [row.lang || 'English (Default)', row.avg_fit]));

  const stats = dash?.assessmentStats;
  const stages = dash?.applicationsByStage ?? [];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Intelligence"
        title="Analytics & Fairness"
        sub="Hiring funnel conversion, candidate psychometric metrics distribution, and demographic adverse impact analysis."
      />

      {(dashLoading || fairLoading) && <Empty message="Loading analytics data…" />}
      {(dashError || fairError) && <Empty message="Could not load analytics. Please ensure your tenant account is active." />}

      {dash && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
            <KPI value={stats?.total ?? '0'} label="Assessments Scored" />
            <KPI value={stats?.avg_fit ? `${Number(stats.avg_fit).toFixed(1)}%` : '—'} label="Avg Role Fit" />
            <KPI value={stats?.avg_iq ? Number(stats.avg_iq).toFixed(1) : '—'} label="Avg Reasoning (IQ Sten)" />
            <KPI value={stats?.avg_eq ? Number(stats.avg_eq).toFixed(1) : '—'} label="Avg Emotional/EQ" />
            <KPI value={stats?.avg_grit ? Number(stats.avg_grit).toFixed(1) : '—'} label="Avg Persistence/Grit" />
          </div>

          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Hiring Funnel by Stage</h3>
            {stages.length === 0 ? (
              <Empty message="No application stage data yet." />
            ) : (
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: '10px' }}>
                {stages.map((st) => (
                  <div key={st.stage} style={{ padding: '12px', border: '1px solid var(--line)', borderRadius: '6px', background: 'var(--bg-2)' }}>
                    <div style={{ fontSize: '0.75rem', color: 'var(--fg-3)', textTransform: 'uppercase', marginBottom: '4px' }}>{st.stage}</div>
                    <div style={{ fontSize: '1.4rem', fontWeight: 700, color: 'var(--fg-1)' }}>{st.count}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1rem', fontWeight: 600 }}>Fairness & Adverse Impact Report</h3>
                <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--fg-2)' }}>
                  Monitors selection rates across candidate preferred languages to ensure compliance with the 4/5ths (80%) fairness rule.
                </p>
              </div>
              {fairness && <Tag color={STATUS_COLOR[report.overall]}>{OVERALL_LABEL[report.overall]}</Tag>}
            </div>

            {fairness && fairness.length > 0 ? (
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.85rem', marginTop: '10px' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--line)', textAlign: 'left', color: 'var(--fg-3)' }}>
                    <th style={{ padding: '8px' }}>Demographic / Language</th>
                    <th style={{ padding: '8px' }}>Total Candidates</th>
                    <th style={{ padding: '8px' }}>Shortlisted</th>
                    <th style={{ padding: '8px' }}>Selection Rate</th>
                    <th style={{ padding: '8px' }}>Impact Ratio</th>
                    <th style={{ padding: '8px' }}>Average Fit Score</th>
                    <th style={{ padding: '8px' }}>4/5ths Rule</th>
                  </tr>
                </thead>
                <tbody>
                  {report.groups.map((g) => {
                    const avgFit = avgFitByGroup.get(g.group);
                    return (
                      <tr key={g.group} style={{ borderBottom: '1px solid var(--line)' }}>
                        <td style={{ padding: '8px', fontWeight: 500 }}>{g.group}</td>
                        <td style={{ padding: '8px' }}>{g.total}</td>
                        <td style={{ padding: '8px' }}>{g.selected}</td>
                        <td style={{ padding: '8px' }}>{g.rate === null ? '—' : `${(g.rate * 100).toFixed(1)}%`}</td>
                        <td style={{ padding: '8px' }}>{g.impactRatio === null ? '—' : g.impactRatio.toFixed(2)}</td>
                        <td style={{ padding: '8px' }}>{avgFit ? `${Number(avgFit).toFixed(1)}%` : '—'}</td>
                        <td style={{ padding: '8px' }}><Tag color={STATUS_COLOR[g.status]}>{g.status}</Tag></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : (
              <div style={{ padding: '12px', fontSize: '0.85rem', color: 'var(--fg-3)' }}>
                No fairness data yet. As candidates apply and progress, selection rates per language will appear here.
              </div>
            )}
          </Panel>
        </>
      )}
    </div>
  );
}

