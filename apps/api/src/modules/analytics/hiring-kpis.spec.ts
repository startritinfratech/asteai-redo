import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { fakeDb } from '../../test-support/fakes';
import { AnalyticsService } from './analytics.service';

function setup(over: { median?: string | null; reviewed?: number; matched?: number } = {}) {
  return fakeDb([
    [/FROM requisitions r WHERE/, [{ open: 4, pending: 2 }]],
    [/FROM ats_outreach_campaigns c WHERE c.status = 'queued'/, [{ active: 1 }]],
    [/PERCENTILE_CONT\(0.5\)/, [{ median_days: over.median === undefined ? '23.456' : over.median, hires: over.median === null ? 0 : 3 }]],
    [/AS reviewed/, [{ reviewed: over.reviewed ?? 40, matched: over.matched ?? 14 }]],
    [/GROUP BY a.stage/, [{ stage: 'Applied', n: 10 }, { stage: 'Interview', n: 3 }]],
  ]);
}

describe('AnalyticsService.getHiringKpis', () => {
  it('maps the aggregates for a company, scoped to its tenant', async () => {
    const db = setup();
    const k = await new AnalyticsService(db.pool).getHiringKpis('T1');
    assert.deepEqual(k, {
      openRequisitions: 4, pendingApproval: 2, activeCampaigns: 1, timeToHireDays: 23.5, hiresLast180Days: 3,
      matchRatePct: 35, reviewedLast90Days: 40, byStage: { Applied: 10, Interview: 3 },
    });
    assert.ok(db.log.every((q) => q.params[0] === 'T1' && /tenant_id = \$1/.test(q.sql)), 'every query is tenant-scoped');
  });

  it('admins (no company) see the whole platform; no data reads as null, not zero', async () => {
    const db = setup({ median: null, reviewed: 0, matched: 0 });
    const k = await new AnalyticsService(db.pool).getHiringKpis(null);
    assert.equal(k.timeToHireDays, null);
    assert.equal(k.matchRatePct, null);
    assert.ok(db.log.every((q) => q.params.length === 0));
  });

  it('time to hire is measured to the Joined entry of the stage history', async () => {
    const db = setup();
    await new AnalyticsService(db.pool).getHiringKpis('T1');
    assert.match(db.all(/PERCENTILE_CONT/)[0].sql, /h->>'stage' = 'Joined'/);
  });
});
