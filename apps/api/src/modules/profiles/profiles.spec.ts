import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import type { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import { buildExpertSearch } from './expert-search';
import { ExpertsService } from './experts.service';
import { expertCompletion, emptyExpertProfile, mapExpertCard, publicName, type ExpertCardRow } from './profile.mapper';
import { ProfilesService } from './profiles.service';
import { ReviewsService } from './reviews.service';

const admin = { id: 'adm-1', role: 'Admin', firstName: 'Ops', lastName: 'Lead' } as User;
const freelancer = { id: '11111111-1111-4111-8111-111111111111', role: 'Freelancer', firstName: 'Asha', lastName: 'Kumar' } as User;
const buyer = { id: '22222222-2222-4222-8222-222222222222', role: 'Buyer', firstName: 'Ben', lastName: 'Shah' } as User;

/** A pool that answers queries in order from `replies` and records the SQL it saw. */
function fakePool(replies: Array<{ rows: unknown[]; rowCount?: number } | Error>) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    const next = replies.shift() ?? { rows: [] };
    if (next instanceof Error) throw next;
    return { rowCount: next.rows.length, ...next };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

/** Records notifications instead of writing them. */
function fakeNotifications() {
  const sent: Array<{ userId: string; text: string; link: string }> = [];
  const svc = { send: async (userId: string, text: string, link: string) => { sent.push({ userId, text, link }); } };
  return { svc: svc as unknown as NotificationsService, sent };
}

/** Records queued emails instead of writing them. */
function fakeEmail() {
  const queued: Array<{ template: string; to: string; data: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  const svc = {
    enqueue: async (template: string, to: string, data: Record<string, unknown>, opts: Record<string, unknown> = {}) => {
      queued.push({ template, to, data, opts });
      return 'mail-1';
    },
  };
  return { svc: svc as unknown as EmailService, queued };
}

const status = (code: number) => (e: HttpException) => e.getStatus() === code;

const cardRow = (over: Partial<ExpertCardRow> & Record<string, unknown> = {}): ExpertCardRow => ({
  user_id: freelancer.id, headline: 'Rust and distributed systems', summary: 'x'.repeat(100),
  domains: ['AI'], skills: ['Rust', 'Go', 'Kafka'], languages: ['English'], years_experience: 8,
  hourly_rate: '45.00', daily_rate: null, fixed_from: null, currency: 'USD', engagement_modes: ['hourly'],
  availability: 'available', location: 'Pune', portfolio_url: null, linkedin_url: null, github_url: null,
  status: 'approved', admin_note: null, reviewed_at: null, rating: '4.50', review_count: 2, completion: 90,
  created_at: new Date(), updated_at: new Date(), first_name: 'Asha', last_name: 'Kumar', avatar_url: null,
  passport_id: 'TP-1', passport_tier: 'Technical', total: '1', ...over,
} as ExpertCardRow);

describe('public expert directory', () => {
  it('only lists approved profiles on active accounts', () => {
    const { text } = buildExpertSearch({});
    assert.match(text, /p\.status = 'approved'/);
    assert.match(text, /u\.account_status = 'active'/);
    assert.match(text, /u\.is_banned = FALSE/);
  });

  it('never selects or returns an email', async () => {
    const { text } = buildExpertSearch({ q: 'rust' });
    assert.doesNotMatch(text, /email/i);
    assert.doesNotMatch(text, /admin_note/);

    // Even if a row carried an email, the card is built field by field.
    const { pool } = fakePool([{ rows: [cardRow({ email: 'asha@example.com', admin_note: 'internal' })] }]);
    const page = await new ExpertsService(pool, fakeNotifications().svc, fakeEmail().svc).list({});
    const json = JSON.stringify(page);
    assert.doesNotMatch(json, /asha@example\.com/);
    assert.doesNotMatch(json, /internal/);
    assert.equal(page.items[0].name, 'Asha K.');
    assert.equal(page.total, 1);
    assert.deepEqual(page.items[0].passport, { id: 'TP-1', tier: 'Technical' });
  });

  it('binds every filter as a parameter instead of interpolating it', () => {
    const evil = "x'); DROP TABLE user_accounts; --";
    const { text, values } = buildExpertSearch({
      q: evil, domain: evil, skill: evil, minRate: 10, maxRate: 90, availability: 'limited',
      engagement: 'sprint', sort: 'relevance', page: 2, pageSize: 5,
    });
    assert.ok(!text.includes(evil));
    assert.ok(!text.includes('DROP TABLE'));
    assert.deepEqual(values, [evil, evil, evil, 10, 90, 'limited', 'sprint', 5, 5]);
    assert.match(text, /p\.search @@ plainto_tsquery\('english', \$1\)/);
    assert.match(text, /ts_rank_cd\(p\.search, plainto_tsquery\('english', \$1\)\) DESC/);
    assert.match(text, /p\.hourly_rate >= \$4/);
    assert.match(text, /\$7 = ANY\(p\.engagement_modes\)/);
    assert.match(text, /LIMIT \$8 OFFSET \$9/);
    // Every placeholder in the SQL has a value.
    const used = [...text.matchAll(/\$(\d+)/g)].map((m) => Number(m[1]));
    assert.equal(Math.max(...used), values.length);
  });

  it('sorts by rate or rating without a search term', () => {
    assert.match(buildExpertSearch({ sort: 'rate' }).text, /ORDER BY p\.hourly_rate ASC NULLS LAST/);
    assert.match(buildExpertSearch({}).text, /ORDER BY p\.rating DESC/);
  });

  it('rejects an inverted rate range', () => {
    assert.throws(() => buildExpertSearch({ minRate: 100, maxRate: 10 }), status(400));
  });

  it('hides a non-approved profile from the public but shows it to its owner', async () => {
    const anon = fakePool([{ rows: [] }]);
    await assert.rejects(new ExpertsService(anon.pool, fakeNotifications().svc, fakeEmail().svc).detail(freelancer.id, null), status(404));
    assert.equal(anon.params[0][1], false);

    const own = fakePool([{ rows: [cardRow({ status: 'pending' })] }, { rows: [] }]);
    const detail = await new ExpertsService(own.pool, fakeNotifications().svc, fakeEmail().svc).detail(freelancer.id, freelancer);
    assert.equal(own.params[0][1], true);
    assert.equal(detail.status, 'pending');
    assert.equal((detail as unknown as Record<string, unknown>).email, undefined);
  });
});

describe('admin approvals', () => {
  it('approves a pending profile, audits it, notifies and emails the freelancer', async () => {
    const reviewedAt = new Date('2026-11-10T09:30:00Z');
    const { pool, sql, params } = fakePool([
      { rows: [{ status: 'pending' }] },
      { rows: [{ ...cardRow({ reviewed_at: reviewedAt }), email: 'asha@example.com' }] },
      { rows: [] }, // audit_log
    ]);
    const n = fakeNotifications();
    const mail = fakeEmail();
    const item = await new ExpertsService(pool, n.svc, mail.svc).setStatus(admin, freelancer.id, { status: 'approved' });
    assert.equal(item.status, 'approved');
    const auditIdx = sql.findIndex((s) => s.includes('INSERT INTO audit_log'));
    assert.ok(auditIdx > 0);
    assert.equal(params[auditIdx][3], 'Approved expert profile');
    assert.deepEqual(JSON.parse(params[auditIdx][5] as string), { from: 'pending', to: 'approved', note: null });
    assert.equal(n.sent.length, 1);
    assert.equal(n.sent[0].userId, freelancer.id);
    assert.equal(mail.queued.length, 1);
    const [queued] = mail.queued;
    assert.equal(queued.template, 'expert-profile-decision');
    assert.equal(queued.to, 'asha@example.com');
    assert.deepEqual(queued.data, { firstName: 'Asha', decision: 'approved', note: null, path: '/platform/profile' });
    assert.equal(queued.opts.userId, freelancer.id);
    assert.ok(queued.opts.client, 'enqueued inside the transaction');
    assert.equal(queued.opts.dedupeKey, `expert-decision:${freelancer.id}:${reviewedAt.toISOString()}`);
    assert.ok(sql.includes('COMMIT'));
  });

  it('requires a note to reject or send back', async () => {
    const { pool, sql } = fakePool([]);
    await assert.rejects(
      new ExpertsService(pool, fakeNotifications().svc, fakeEmail().svc).setStatus(admin, freelancer.id, { status: 'rework' }),
      status(400),
    );
    assert.equal(sql.length, 0);
  });

  it('refuses decisions on a draft profile and rolls back', async () => {
    const { pool, sql } = fakePool([{ rows: [{ status: 'draft' }] }]);
    const n = fakeNotifications();
    const mail = fakeEmail();
    await assert.rejects(
      new ExpertsService(pool, n.svc, mail.svc).setStatus(admin, freelancer.id, { status: 'approved' }),
      status(409),
    );
    assert.ok(sql.includes('ROLLBACK'));
    assert.ok(!sql.some((s) => s.includes('audit_log')));
    assert.equal(n.sent.length, 0);
    assert.equal(mail.queued.length, 0);
  });

  it('can take an approved expert out of the directory with a note', async () => {
    const { pool } = fakePool([
      { rows: [{ status: 'approved' }] },
      { rows: [{ ...cardRow({ status: 'rework', admin_note: 'Add portfolio' }), email: 'a@b.c' }] },
      { rows: [] },
    ]);
    const mail = fakeEmail();
    const item = await new ExpertsService(pool, fakeNotifications().svc, mail.svc)
      .setStatus(admin, freelancer.id, { status: 'rework', note: 'Add portfolio' });
    assert.equal(item.status, 'rework');
    assert.equal(mail.queued[0].data.decision, 'rework');
    assert.equal(mail.queued[0].data.note, 'Add portfolio');
  });
});

describe('my profile', () => {
  it('rejects other roles', async () => {
    const svc = new ProfilesService(fakePool([]).pool);
    await assert.rejects(svc.getMine({ id: 'c', role: 'Candidate' } as User), status(400));
    await assert.rejects(svc.updateMine({ id: 'c', role: 'Employer' } as User, {}), status(400));
  });

  it('accepts only https URLs and bounded arrays / rates', async () => {
    const svc = new ProfilesService(fakePool([]).pool);
    await assert.rejects(svc.updateMine(freelancer, { portfolioUrl: 'http://example.com' }), status(400));
    await assert.rejects(svc.updateMine(freelancer, { githubUrl: 'javascript:alert(1)' }), status(400));
    await assert.rejects(svc.updateMine(freelancer, { skills: Array.from({ length: 31 }, (_, i) => `s${i}`) }), status(400));
    await assert.rejects(svc.updateMine(freelancer, { hourlyRate: -1 }), status(400));
    await assert.rejects(svc.updateMine(freelancer, { engagementModes: ['weekly'] }), status(400));
    await assert.rejects(svc.updateMine(freelancer, { email: 'x@y.z' }), status(400));
    await assert.rejects(svc.updateMine(buyer, { website: 'ftp://acme.com' }), status(400));
  });

  it('saves a partial update with a recomputed completion', async () => {
    const { pool, params } = fakePool([{ rows: [] }, { rows: [cardRow({ status: 'draft' })] }]);
    await new ProfilesService(pool).updateMine(freelancer, {
      headline: '  Rust engineer  ', skills: ['Rust', ' Go ', ''], portfolioUrl: 'https://asha.dev',
    });
    const upsert = params[1];
    assert.equal(upsert[1], 'Rust engineer');
    assert.deepEqual(upsert[4], ['Rust', 'Go']);
    assert.equal(upsert[14], 'https://asha.dev');
    assert.equal(upsert[17], 15 + 15); // headline + link
  });

  it('submits only from draft / rework / rejected with the basics filled in', async () => {
    const ready = cardRow({ status: 'draft' });
    const ok = fakePool([{ rows: [ready] }, { rows: [{ ...ready, status: 'pending' }] }]);
    assert.equal((await new ProfilesService(ok.pool).submit(freelancer)).status, 'pending');

    const pending = fakePool([{ rows: [cardRow({ status: 'pending' })] }]);
    await assert.rejects(new ProfilesService(pending.pool).submit(freelancer), status(409));

    const thin = fakePool([{ rows: [cardRow({ status: 'rework', skills: ['Rust'] })] }]);
    await assert.rejects(new ProfilesService(thin.pool).submit(freelancer), status(400));
  });

  it('scores completion out of 100', () => {
    assert.equal(expertCompletion(emptyExpertProfile('u')), 0);
    const full = { ...emptyExpertProfile('u'), headline: 'A long enough headline', summary: 'y'.repeat(80),
      skills: ['a', 'b', 'c'], domains: ['AI'], languages: ['English'], yearsExperience: 3, hourlyRate: 10,
      engagementModes: ['hourly' as const], location: 'Pune', githubUrl: 'https://github.com/a' };
    assert.equal(expertCompletion(full), 100);
  });
});

describe('reviews', () => {
  const dto = { revieweeId: freelancer.id, projectId: 'PRJ-1', rating: 5, comment: 'Great' };
  const project = (over: Record<string, unknown> = {}) =>
    ({ rows: [{ buyer_id: buyer.id, awarded_to: freelancer.id, stage: 'Completed', title: 'Edge AI', ...over }] });

  it('lets the buyer review the awarded freelancer and updates the rating in the same transaction', async () => {
    const { pool, sql } = fakePool([
      project(), { rows: [{}] }, { rows: [{ id: 'r1', created_at: new Date() }] }, { rows: [] },
    ]);
    const n = fakeNotifications();
    const review = await new ReviewsService(pool, n.svc).create(buyer, dto);
    assert.equal(review.rating, 5);
    assert.equal(review.reviewerName, 'Ben S.');
    const begin = sql.indexOf('BEGIN');
    const update = sql.findIndex((s) => s.includes('UPDATE expert_profiles'));
    const commit = sql.indexOf('COMMIT');
    assert.ok(begin < update && update < commit);
    assert.match(sql[update], /review_count = agg\.n/);
    assert.equal(n.sent[0].userId, freelancer.id);
  });

  it('refuses before the project is completed', async () => {
    const { pool, sql } = fakePool([project({ stage: 'In Progress' })]);
    await assert.rejects(new ReviewsService(pool, fakeNotifications().svc).create(buyer, dto), status(409));
    assert.ok(!sql.some((s) => s.includes('INSERT INTO reviews')));
  });

  it('refuses anyone outside the buyer / awarded freelancer pair', async () => {
    const stranger = { id: '33333333-3333-4333-8333-333333333333', role: 'Buyer' } as User;
    const a = fakePool([project()]);
    await assert.rejects(new ReviewsService(a.pool, fakeNotifications().svc).create(stranger, dto), status(403));
    const b = fakePool([project({ awarded_to: null })]);
    await assert.rejects(new ReviewsService(b.pool, fakeNotifications().svc).create(buyer, dto), status(403));
    const self = fakePool([project()]);
    await assert.rejects(
      new ReviewsService(self.pool, fakeNotifications().svc).create(freelancer, { ...dto, revieweeId: freelancer.id }),
      status(403),
    );
  });

  it('turns a duplicate review into 409', async () => {
    const dup = Object.assign(new Error('duplicate key'), { code: '23505' });
    const { pool, sql } = fakePool([project(), { rows: [{}] }, dup]);
    await assert.rejects(new ReviewsService(pool, fakeNotifications().svc).create(buyer, dto), status(409));
    assert.ok(sql.includes('ROLLBACK'));
  });

  it('shows reviewers as first name + initial only', () => {
    assert.equal(publicName('Ben', 'Shah'), 'Ben S.');
    assert.equal(publicName(null, null), 'Expert');
    assert.equal(mapExpertCard(cardRow({ last_name: '' })).name, 'Asha');
  });
});
