import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { NotFoundException } from '@nestjs/common';
import { fakeDb } from '../../test-support/fakes';
import type { CredentialsService } from '../credentials/credentials.service';
import { aggregateCompetency, isValidSlug, overallScore, percentileFromCounts, suggestSlug } from './scoring';
import { TalentPassportService } from './talent-passport.service';

describe('aggregateCompetency', () => {
  it('counts only the best attempt per item, so retries can only help', () => {
    const agg = aggregateCompetency([
      { source: 'challenge', refId: 'a', score: 40 },
      { source: 'challenge', refId: 'a', score: 100 },
      { source: 'challenge', refId: 'a', score: 60 },
      { source: 'challenge', refId: 'b', score: 50 },
    ]);
    assert.deepEqual(agg, { score: 75, confidence: 0.5, evidenceCount: 2 });
  });

  it('weights interviews 1.5× a challenge and clamps to 0–100', () => {
    const agg = aggregateCompetency([
      { source: 'challenge', refId: 'a', score: 40 },
      { source: 'interview', refId: 's1', score: 140 },
    ]);
    assert.equal(agg?.score, 76); // (40×1 + 100×1.5) / 2.5
    assert.equal(agg?.confidence, 0.63);
    assert.equal(aggregateCompetency([]), null);
  });

  it('reaches full confidence at four challenge-equivalents', () => {
    const items = ['a', 'b', 'c', 'd', 'e'].map((refId) => ({ source: 'challenge' as const, refId, score: 80 }));
    assert.equal(aggregateCompetency(items)?.confidence, 1);
  });
});

describe('percentiles and overall score', () => {
  it('ranks against others, ties counting half; null with nobody to compare to', () => {
    assert.equal(percentileFromCounts(9, 0, 10), 90);
    assert.equal(percentileFromCounts(4, 2, 10), 50);
    assert.equal(percentileFromCounts(0, 0, 0), null);
  });

  it('overall is the confidence-weighted mean of competencies', () => {
    assert.equal(overallScore([{ score: 90, confidence: 1 }, { score: 40, confidence: 0.25 }]), 80);
    assert.equal(overallScore([]), null);
  });
});

describe('passport slugs', () => {
  it('accepts lowercase addresses and refuses reserved words and PASS- ids', () => {
    assert.equal(isValidSlug('priya-menon'), true);
    for (const bad of ['me', 'verify', 'benchmarks', 'Priya', 'a', 'pass-7k3m9q2x', 'double--dash', '-lead', 'x'.repeat(41)]) {
      assert.equal(isValidSlug(bad), false, bad);
    }
    assert.equal(suggestSlug('Priyā Menon', 'k7q2'), 'priya-menon-k7q2');
    assert.equal(suggestSlug('张伟', 'k7q2'), 'talent-k7q2');
    assert.equal(isValidSlug(suggestSlug('Priyā Menon', 'k7q2')), true);
  });
});

describe('TalentPassportService.bySlug (GET /passports/:slug)', () => {
  const passportRow = (visibility: 'public' | 'private') => ({
    user_id: 'u1', slug: 'priya-menon', headline: 'Backend engineer', visibility, overall_score: '72.5',
    updated_at: new Date('2026-11-01T00:00:00Z'), holder_name: 'Priya Menon',
  });
  const svcFor = (visibility: 'public' | 'private') => new TalentPassportService(fakeDb([
    [/FROM talent_passports p JOIN user_accounts u ON u.id = p.user_id\s+WHERE p.slug/, [passportRow(visibility)]],
    [/FROM competency_scores cs/, [{
      key: 'algorithms', label: 'Algorithms & data structures', category: 'tech', score: '80', confidence: '0.5',
      evidence_count: 2, updated_at: new Date('2026-11-01T00:00:00Z'), below: 8, equal: 0, others: 10,
    }]],
    // Newest first, as the query orders it.
    [/FROM competency_evidence/, [
      { competency_key: 'algorithms', score_after: '80', percentile_after: '80', created_at: new Date('2026-10-20T00:00:00Z') },
      { competency_key: 'algorithms', score_after: '60', percentile_after: '50', created_at: new Date('2026-10-01T00:00:00Z') },
    ]],
    [/FROM talent_passports WHERE user_id <> \$1/, [{ below: 3, equal: 0, others: 4 }]],
    [/FROM credentials/, [{ code: 'AST-7K3M-9Q2X-HJ4P', kind: 'challenge', issued_at: new Date('2026-10-20T00:00:00Z') }]],
  ]).pool, {} as CredentialsService);

  it('shows a public passport with scores, percentiles, the trend and verifiable credentials', async () => {
    const p = await svcFor('public').bySlug('Priya-Menon', null);
    assert.equal(p.holderName, 'Priya Menon');
    assert.deepEqual(p.overall, { score: 72.5, percentile: 75 });
    assert.equal(p.competencies[0].percentile, 80);
    assert.deepEqual(p.competencies[0].trend.map((t) => t.score), [60, 80], 'trend reads oldest first');
    assert.equal(p.credentials[0].verifyPath, '/verify/AST-7K3M-9Q2X-HJ4P');
  });

  it('hides a private passport from everyone but its holder and admins', async () => {
    await assert.rejects(svcFor('private').bySlug('priya-menon', null), NotFoundException);
    await assert.rejects(svcFor('private').bySlug('priya-menon', { id: 'someone', role: 'Employer' }), NotFoundException);
    assert.equal((await svcFor('private').bySlug('priya-menon', { id: 'u1', role: 'Candidate' })).slug, 'priya-menon');
    assert.equal((await svcFor('private').bySlug('priya-menon', { id: 'admin', role: 'Admin' })).slug, 'priya-menon');
  });
});
