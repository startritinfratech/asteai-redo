import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import type { ExpertCard, ExpertSearchIntent } from '@asteai/types';
import { fakeDb, type Route } from '../../test-support/fakes';
import { CreditsService } from '../credits/credits.service';
import { AI_SEARCH_FEATURE, candidateQuery, ExpertSearchService } from './expert-search.module';
import { normalizeIntent, type IntentParser } from './intent-parser';
import { rankExperts, termMatches, type Candidate } from './ranking';

const INTENT: ExpertSearchIntent = {
  summary: 'Senior React developer for a fintech dashboard', skills: ['React', 'TypeScript'], domains: ['Fintech'],
  competencies: ['system_design'], minYears: 5, maxHourlyRate: 2000, currency: 'INR', availability: 'available',
  engagement: null, location: null, languages: [],
};

const card = (o: Partial<ExpertCard>): ExpertCard => ({
  userId: 'u', name: 'A K.', avatarUrl: null, headline: '', skills: [], domains: [], hourlyRate: null, dailyRate: null,
  fixedFrom: null, currency: 'INR', engagementModes: ['hourly'], availability: 'available', location: '', yearsExperience: 6,
  rating: 4.5, reviewCount: 10, passport: null, ...o,
});
const cand = (o: Partial<ExpertCard>, competencies: Record<string, number> = {}, overall: number | null = null): Candidate =>
  ({ card: card(o), competencies, overallScore: overall, text: '' });

// ── Credit handling ──────────────────────────────────────────────────────────

/** A real CreditsService over a fake wallet holding `balance` credits in one lot. */
function wallet(balance: number, extra: Route[] = []) {
  return fakeDb([
    ...extra,
    [/SELECT cost FROM credit_costs WHERE feature = \$1/, (p) => (p[0] === AI_SEARCH_FEATURE ? [{ cost: 15 }] : [])],
    [/^INSERT INTO wallets/, []],
    [/^SELECT 1 FROM wallets/, [{}]],
    [/^WITH stale AS/, [{ balance, subscription_tier: 'free', subscription_status: null, current_period_end: null }]],
    [/FROM credit_transactions\s+WHERE user_id = \$1 AND type IN/, balance
      ? [{ id: 'lot-1', remaining_amount: balance, expires_at: null, created_at: new Date('2026-01-01'), db_now: new Date() }] : []],
    [/^UPDATE credit_transactions t SET remaining_amount = t.remaining_amount - v.amt/, []],
    [/^INSERT INTO credit_transactions \(user_id, type, amount, feature_key/, [{ id: 'spend-1' }]],
    [/^UPDATE credit_transactions\s+SET status = 'refunded'/, [{ user_id: 'b1', amount: -15, feature_key: AI_SEARCH_FEATURE, metadata: { allocations: [{ lotId: 'lot-1', amount: 15 }] } }]],
    [/^SELECT id, expires_at, NOW\(\) AS db_now FROM credit_transactions/, [{ id: 'lot-1', expires_at: null, db_now: new Date() }]],
    [/^INSERT INTO credit_transactions\s+\(user_id, type, amount, remaining_amount, expires_at/, [{ id: 'refund-1' }]],
    [/^UPDATE wallets SET balance = balance \+ \$2/, (p) => [{ balance: balance + Number(p[1]) }]],
  ]);
}

const expertRow = (o: Record<string, unknown>) => ({
  user_id: 'e1', headline: 'React engineer', summary: '', domains: ['Fintech'], skills: ['React', 'TypeScript'], languages: [],
  years_experience: 7, hourly_rate: '1500', daily_rate: null, fixed_from: null, currency: 'INR', engagement_modes: ['hourly'],
  availability: 'available', location: 'Pune', portfolio_url: null, linkedin_url: null, github_url: null, status: 'approved',
  rating: '4.8', review_count: 12, completion: 100, created_at: new Date(), updated_at: new Date(), first_name: 'Asha',
  last_name: 'Kumar', avatar_url: null, passport_id: null, passport_tier: null, text: 'react engineer',
  competency_scores: { system_design: '82' }, overall_score: '78', ...o,
});

const parser = (out: unknown | Error) => {
  let calls = 0;
  return {
    p: { parse: async () => { calls++; if (out instanceof Error) throw out; return out; } } as IntentParser,
    calls: () => calls,
  };
};

describe('POST /experts/ai-search: credits', () => {
  it('deducts 15 credits with consumeCredits (FIFO, before parsing) and returns ranked experts with the new balance', async () => {
    const db = wallet(40, [[/FROM expert_profiles p/, [expertRow({}), expertRow({ user_id: 'e2', skills: ['Vue'], domains: ['Retail'], competency_scores: null, overall_score: null })]]]);
    const out = await new ExpertSearchService(db.pool, new CreditsService(db.pool), parser(INTENT).p)
      .search({ id: 'b1' }, { query: 'senior react dev for fintech under 2000 an hour' });
    assert.deepEqual(out.credits, { charged: 15, balance: 25 });
    const [spend] = db.all(/^INSERT INTO credit_transactions \(user_id, type, amount, feature_key/);
    assert.deepEqual(spend.params.slice(0, 3), ['b1', -15, AI_SEARCH_FEATURE]);
    const order = db.log.map((q) => q.sql);
    assert.ok(order.findIndex((s) => /INSERT INTO credit_transactions \(user_id, type, amount, feature_key/.test(s)) < order.findIndex((s) => /FROM expert_profiles p/.test(s)),
      'charged before the search runs');
    assert.equal(out.results[0].expert.userId, 'e1');
    assert.equal(out.considered, 2);
    assert.equal(db.all(/SET status = 'refunded'/).length, 0);
  });

  it('voice transcripts cost the same and pass their language to the parser', async () => {
    let seen: unknown;
    const db = wallet(15, [[/FROM expert_profiles p/, []]]);
    const p: IntentParser = { parse: async (i) => { seen = i; return INTENT; } };
    const out = await new ExpertSearchService(db.pool, new CreditsService(db.pool), p)
      .search({ id: 'b1' }, { query: 'मुझे react developer चाहिए', source: 'voice', language: 'hi' });
    assert.deepEqual(seen, { query: 'मुझे react developer चाहिए', source: 'voice', language: 'hi' });
    assert.equal(out.credits.charged, 15);
    assert.deepEqual(out.results, [], 'a search that ran but found nobody keeps the charge');
  });

  it('refunds automatically when the AI parser fails', async () => {
    const db = wallet(40);
    await assert.rejects(new ExpertSearchService(db.pool, new CreditsService(db.pool), parser(new Error('model down')).p)
      .search({ id: 'b1' }, { query: 'react dev' }), /model down/);
    assert.equal(db.all(/SET status = 'refunded'/).length, 1);
    assert.deepEqual(db.all(/^UPDATE wallets SET balance = balance \+ \$2/).map((q) => q.params[1]), [-15, 15]);
  });

  it('refunds when the search query itself fails', async () => {
    const db = wallet(40, [[/FROM expert_profiles p/, () => ({ error: new Error('db timeout') })]]);
    await assert.rejects(new ExpertSearchService(db.pool, new CreditsService(db.pool), parser(INTENT).p)
      .search({ id: 'b1' }, { query: 'react dev' }), /db timeout/);
    assert.equal(db.all(/SET status = 'refunded'/).length, 1);
  });

  it('402 INSUFFICIENT_CREDITS without calling the model when the wallet is short', async () => {
    const pr = parser(INTENT);
    const db = wallet(10);
    await assert.rejects(new ExpertSearchService(db.pool, new CreditsService(db.pool), pr.p).search({ id: 'b1' }, { query: 'react dev' }),
      (err: unknown) => err instanceof HttpException && err.getStatus() === 402);
    assert.equal(pr.calls(), 0);
  });

  it('503 and no charge when AI search is not configured', async () => {
    const db = wallet(40);
    await assert.rejects(new ExpertSearchService(db.pool, new CreditsService(db.pool), null).search({ id: 'b1' }, { query: 'x y z' }), ServiceUnavailableException);
    assert.equal(db.log.length, 0);
  });
});

// ── Parsing & ranking ────────────────────────────────────────────────────────

describe('intent normalisation', () => {
  it('keeps only known competencies, enums and sane numbers', () => {
    const i = normalizeIntent({
      summary: '', skills: ['React', 'React', ''], competencies: ['system_design', 'charisma'], minYears: 5.6, maxHourlyRate: -5,
      currency: 'inr', availability: 'tomorrow', engagement: 'sprint', languages: ['Hindi'],
    }, 'need a react dev');
    assert.equal(i.summary, 'need a react dev');
    assert.deepEqual(i.skills, ['React']);
    assert.deepEqual(i.competencies, ['system_design']);
    assert.equal(i.minYears, 6);
    assert.equal(i.maxHourlyRate, null);
    assert.equal(i.currency, 'INR');
    assert.equal(i.availability, null);
    assert.equal(i.engagement, 'sprint');
  });
});

describe('ranking', () => {
  it('matches tech terms loosely (node ~ Node.js, postgres ~ PostgreSQL) but not unrelated ones', () => {
    assert.ok(termMatches('node', 'Node.js'));
    assert.ok(termMatches('postgres', 'PostgreSQL'));
    assert.ok(termMatches('React', 'react'));
    assert.equal(termMatches('Go', 'Google Ads'), false);
    assert.equal(termMatches('Java', 'JavaScript') && termMatches('JavaScript', 'Java'), true, 'prefix match is symmetric');
  });

  it('ranks verified competency and domain fit above an unverified keyword match', () => {
    const ranked = rankExperts([
      cand({ userId: 'keywords', skills: ['React', 'TypeScript'], domains: [] }),
      cand({ userId: 'verified', skills: ['React', 'TypeScript'], domains: ['Fintech'] }, { system_design: 85 }),
    ], INTENT, 10);
    assert.deepEqual(ranked.map((r) => r.expert.userId), ['verified', 'keywords']);
    assert.equal(ranked[0].competencyScore, 85);
    assert.ok(ranked[0].reasons.includes('Passport system design 85'));
    assert.deepEqual(ranked[0].matchedDomains, ['Fintech']);
  });

  it('hard limits remove experts: over budget (same currency) or too junior', () => {
    const ranked = rankExperts([
      cand({ userId: 'pricey', skills: ['React'], hourlyRate: 3500 }),
      cand({ userId: 'usd', skills: ['React'], hourlyRate: 3500, currency: 'USD' }),
      cand({ userId: 'junior', skills: ['React'], yearsExperience: 2 }),
      cand({ userId: 'unknown-years', skills: ['React'], yearsExperience: null }),
      cand({ userId: 'fits', skills: ['React'], hourlyRate: 1800 }),
    ], INTENT, 10).map((r) => r.expert.userId);
    assert.ok(!ranked.includes('pricey'));
    assert.ok(!ranked.includes('junior'));
    assert.ok(ranked.includes('usd'), 'a budget in another currency is not compared');
    assert.ok(ranked.includes('unknown-years'));
    assert.equal(ranked[0], 'fits');
  });

  it('only public passports feed the ranking, and the candidate query is parameterised', () => {
    const q = candidateQuery({ ...INTENT, skills: ["React'); DROP TABLE x;--"] });
    assert.match(q.text, /tp\.visibility = 'public'/);
    assert.match(q.text, /p\.status = 'approved'/, 'vetted experts only');
    assert.doesNotMatch(q.text, /DROP TABLE/);
    assert.deepEqual(q.values[0], ["react'); drop table x;--", 'fintech']);
  });
});
