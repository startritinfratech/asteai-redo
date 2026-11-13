import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { fakeDb } from '../../test-support/fakes';
import { buildJobFilters, decodeCursor, encodeCursor, mapPublicJob, PUBLIC_JOB_WHERE, type PublicJobRow } from './job-board';
import { countryFrom } from './public.controller';
import { PublicService } from './public.service';

const row = (id: string, publishedAt: string, over: Partial<PublicJobRow> = {}): PublicJobRow => ({
  id, title: 'Engineer', func: 'Engineering', brief: 'Build things', location_type: 'remote', location: 'India',
  salary_min: '1000000', salary_max: '2000000', salary_currency: 'INR', requirements: ['5+ years'],
  employment_type: 'full_time', frontline_role: null, published_at: new Date(publishedAt), expires_at: null,
  company_name: 'Acme', company_logo: null, company_website: 'https://acme.com', application_count: 3, ...over,
});

describe('job board helpers', () => {
  it('round-trips a cursor and rejects tampered ones', () => {
    const c = { publishedAt: '2026-11-01T10:00:00.000Z', id: 'REQ-ABC123' };
    assert.deepEqual(decodeCursor(encodeCursor(c)), c);
    assert.equal(decodeCursor(undefined), null);
    assert.equal(decodeCursor('not-base64-%%%'), null);
    assert.equal(decodeCursor(Buffer.from('2026-11-01|id|extra').toString('base64url')), null);
    assert.equal(decodeCursor(Buffer.from("nope|REQ-1").toString('base64url')), null);
    assert.equal(decodeCursor(Buffer.from("2026-11-01|x'; DROP TABLE r;--").toString('base64url')), null);
  });

  it('always applies the board visibility rule, and escapes LIKE wildcards in search', () => {
    const none = buildJobFilters({});
    assert.equal(none.where, PUBLIC_JOB_WHERE);
    const f = buildJobFilters({ q: '50%_off', locationType: 'remote', employmentType: 'contract' });
    assert.ok(f.where.startsWith(PUBLIC_JOB_WHERE));
    assert.deepEqual(f.params, ['%50\\%\\_off%', 'remote', 'contract']);
  });

  it('the visibility rule hides private, closed, unpublished, expired and test-tenant rows', () => {
    for (const fragment of ['r.is_public', "r.status = 'Open'", 'NOT t.is_test', 'r.published_at IS NOT NULL', 'r.expires_at > NOW()']) {
      assert.ok(PUBLIC_JOB_WHERE.includes(fragment), fragment);
    }
  });

  it('maps numeric strings to numbers and blanks to null', () => {
    const job = mapPublicJob(row('REQ-1', '2026-11-01T00:00:00Z', { salary_max: null, func: '' }));
    assert.equal(job.salaryMin, 1000000);
    assert.equal(job.salaryMax, null);
    assert.equal(job.department, null);
    assert.equal(job.company.name, 'Acme');
  });
});

describe('PublicService.listJobs', () => {
  it('fetches limit + 1 to decide the next cursor, and returns limit items', async () => {
    const rows = [row('REQ-3', '2026-11-03T00:00:00Z'), row('REQ-2', '2026-11-02T00:00:00Z'), row('REQ-1', '2026-11-01T00:00:00Z')];
    const db = fakeDb([[/COUNT\(\*\)::int AS total/, [{ total: 3 }]], [/ORDER BY r.published_at DESC/, rows]]);
    const page = await new PublicService(db.pool).listJobs({}, 2);
    assert.deepEqual(page.items.map((j) => j.id), ['REQ-3', 'REQ-2']);
    assert.equal(page.total, 3);
    assert.deepEqual(decodeCursor(page.nextCursor!), { publishedAt: '2026-11-02T00:00:00.000Z', id: 'REQ-2' });
    assert.equal(db.all(/ORDER BY/)[0].params.at(-1), 3);
  });

  it('applies a valid cursor as a keyset condition and ignores a bad one', async () => {
    const db = fakeDb([[/COUNT\(\*\)::int AS total/, [{ total: 0 }]]]);
    const svc = new PublicService(db.pool);
    await svc.listJobs({ q: 'ml' }, 10, encodeCursor({ publishedAt: '2026-11-02T00:00:00.000Z', id: 'REQ-2' }));
    const q1 = db.all(/ORDER BY/)[0];
    assert.match(q1.sql, /\(r\.published_at, r\.id\) < \(\$2::timestamptz, \$3\)/);
    assert.deepEqual(q1.params, ['%ml%', '2026-11-02T00:00:00.000Z', 'REQ-2', 11]);
    await svc.listJobs({}, 10, 'garbage');
    assert.doesNotMatch(db.all(/ORDER BY/)[1].sql, /published_at, r\.id\) </);
  });

  it('has no next cursor on the last page', async () => {
    const db = fakeDb([[/COUNT\(\*\)::int AS total/, [{ total: 1 }]], [/ORDER BY/, [row('REQ-1', '2026-11-01T00:00:00Z')]]]);
    assert.equal((await new PublicService(db.pool).listJobs({}, 20)).nextCursor, null);
  });
});

describe('PublicService other reads', () => {
  it('404s a job that is not on the board', async () => {
    await assert.rejects(new PublicService(fakeDb([]).pool).getJob('REQ-X'), NotFoundException);
  });

  it('shapes credit settings with safe defaults for missing keys', async () => {
    const db = fakeDb([
      [/FROM platform_settings/, [{ key: 'welcome_bonus_credits', value: 5 }, { key: 'proposal_budget_tiers', value: [5000, 'x', 25000] }]],
      [/FROM credit_costs/, [{ feature: 'proposal', label: 'Proposal', cost: 3, cost_max: 12 }]],
    ]);
    const s = await new PublicService(db.pool).creditSettings();
    assert.equal(s.welcomeBonusCredits, 5);
    assert.equal(s.referralBonusCredits, 0);
    assert.deepEqual(s.proposalBudgetTiers, [5000, 25000]);
    assert.deepEqual(s.costs, [{ feature: 'proposal', label: 'Proposal', cost: 3, costMax: 12 }]);
  });

  it('filters plans by audience', async () => {
    const db = fakeDb([[/FROM plans/, []]]);
    await new PublicService(db.pool).plans('employer');
    assert.deepEqual(db.log[0].params, ['employer']);
  });
});

describe('countryFrom', () => {
  it('reads CloudFront / Cloudflare headers and rejects junk', () => {
    assert.equal(countryFrom({ 'cloudfront-viewer-country': 'IN' }), 'IN');
    assert.equal(countryFrom({ 'cf-ipcountry': 'US' }), 'US');
    assert.equal(countryFrom({ 'cf-ipcountry': 'XX' }), null);
    assert.equal(countryFrom({ 'cloudfront-viewer-country': 'india' }), null);
    assert.equal(countryFrom({}), null);
  });
});
