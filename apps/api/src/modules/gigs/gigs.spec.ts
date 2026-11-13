import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { GigOrderStatus, User } from '@asteai/types';
import { gigOrderStatusFor, CONTRACT_MILESTONE_STATUSES } from '@asteai/types';
import type { NotificationsService } from '../notifications/notifications.service';
import type { EmailService } from '../email/email.service';
import type { ContractsService, MilestoneHooks } from '../contracts/contracts.service';
import { GigOrdersService } from './gig-orders.service';
import { ServicesService } from './services.service';
import {
  assertPackageSet, cleanList, deliveryNote, isHttpsLink, publicName, slugify, submitProblem,
} from './gig-rules';
import { PUBLIC_EXPERT_SQL } from '../profiles/expert-search';
import { GIG_SWEEP_LOCK_KEY, GigSweepService } from './gig-sweep.service';
import { mapOrder } from './gig.mapper';
import { buildServiceSearch } from './service-search';

type Rows = unknown[];
type Route = [RegExp, Rows | ((params: unknown[]) => Rows | { error: unknown })];

/** A pool that answers by matching the SQL against routes (first match wins) and records every statement. */
function fakeDb(routes: Route[]) {
  const log: { sql: string; params: unknown[] }[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    log.push({ sql: text, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    for (const [re, reply] of routes) {
      if (re.test(text)) {
        const out = typeof reply === 'function' ? reply(params) : reply;
        if (!Array.isArray(out)) throw (out as { error: unknown }).error;
        return { rows: out, rowCount: out.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  const index = (re: RegExp) => log.findIndex((q) => re.test(q.sql));
  const all = (re: RegExp) => log.filter((q) => re.test(q.sql));
  return { pool, log, index, all };
}

function fakeNotifications() {
  const sent: { userId: string; text: string; link: string }[] = [];
  const svc = {
    send: async (userId: string, text: string, link: string) => { sent.push({ userId, text, link }); return {}; },
  } as unknown as NotificationsService;
  return { svc, sent };
}

function fakeEmail() {
  const queued: { template: string; to: string; data: Record<string, unknown> }[] = [];
  const svc = {
    enqueue: async (template: string, to: string, data: Record<string, unknown>) => { queued.push({ template, to, data }); return 'm'; },
  } as unknown as EmailService;
  return { svc, queued };
}

const status = (code: number) => (e: HttpException) => e.getStatus() === code;

const expert = { id: 'exp-1', role: 'Freelancer', firstName: 'Eshan', lastName: 'Expert' } as User;
const buyer = { id: 'buyer-1', role: 'Buyer', firstName: 'Bina', lastName: 'Buyer', tenantId: null } as User;
const other = { id: 'other-1', role: 'Buyer' } as User;
const admin = { id: 'adm-1', role: 'Admin', firstName: 'Ada', lastName: 'Admin' } as User;

const serviceRow = (over: Record<string, unknown> = {}) => ({
  id: 'SVC-1', expert_id: 'exp-1', title: 'Security audit', slug: 'security-audit-1', category: 'Security & compliance',
  summary: 'We audit your code', description: 'Long description', tags: ['security'], status: 'draft', admin_note: null,
  rating: '0', review_count: 0, created_at: new Date(), updated_at: new Date(), first_name: 'Eshan', last_name: 'Expert',
  email: 'eshan@example.com', ...over,
});
const packageRow = (over: Record<string, unknown> = {}) => ({
  id: 'PKG-1', service_id: 'SVC-1', tier: 'basic', name: 'Basic', description: '', price: '5000.00', delivery_days: 5,
  revisions: 1, features: ['Report'], ...over,
});

// ─── Pure rules ─────────────────────────────────────────────────────────────

describe('gig rules', () => {
  it('slugifies titles', () => {
    assert.equal(slugify('Full-Stack Security & Compliance Audit!'), 'full-stack-security-compliance-audit');
    assert.equal(slugify('  Café  déploiement '), 'cafe-deploiement');
    assert.equal(slugify('!!!'), 'service');
  });

  it('shows the expert as first name and last initial only', () => {
    assert.equal(publicName('Aarav', 'Sharma'), 'Aarav S.');
    assert.equal(publicName('Aarav', null), 'Aarav');
    assert.equal(publicName(null, null), 'AsteAI expert');
  });

  it('accepts https links with a host only', () => {
    assert.ok(isHttpsLink('https://example.com/file.zip'));
    for (const bad of ['http://example.com', 'javascript:alert(1)', 'ftp://x.com', 'https://localhost', 'not a url']) {
      assert.equal(isHttpsLink(bad), false, bad);
    }
  });

  it('validates the package set: 1 to 3, one per tier, price above zero', () => {
    assertPackageSet([{ tier: 'basic', price: 10 }]);
    assertPackageSet([{ tier: 'basic', price: 10 }, { tier: 'standard', price: 20 }, { tier: 'premium', price: 30 }]);
    assert.throws(() => assertPackageSet([]), status(400));
    assert.throws(() => assertPackageSet([{ tier: 'basic', price: 10 }, { tier: 'basic', price: 20 }]), status(400));
    assert.throws(() => assertPackageSet([{ tier: 'basic', price: 0 }]), status(400));
    assert.throws(() => assertPackageSet([
      { tier: 'basic', price: 1 }, { tier: 'standard', price: 1 }, { tier: 'premium', price: 1 }, { tier: 'basic', price: 1 },
    ]), status(400));
  });

  it('says what stops a submit', () => {
    assert.match(submitProblem({ summary: 's', description: 'd' }, 0) ?? '', /package/);
    assert.match(submitProblem({ summary: ' ', description: 'd' }, 1) ?? '', /summary/);
    assert.match(submitProblem({ summary: 's', description: '' }, 1) ?? '', /description/);
    assert.equal(submitProblem({ summary: 's', description: 'd' }, 1), null);
  });

  it('cleans lists and composes the delivery note', () => {
    assert.deepEqual(cleanList([' a ', 'A', '', 'b  c']), ['a', 'b c']);
    assert.equal(deliveryNote('done', ['https://x.com/a']), 'done\n\nLinks:\nhttps://x.com/a');
    assert.equal(deliveryNote('x'.repeat(5000), []).length, 4000);
  });

  it('maps every contract milestone status to an order status (mirrors the trigger in migration 014)', () => {
    const expected: Record<string, GigOrderStatus> = {
      pending: 'awaiting_payment', funded: 'in_progress', submitted: 'delivered', accepted: 'delivered',
      revision_requested: 'revision_requested', released: 'completed', cancelled: 'cancelled',
    };
    assert.deepEqual(Object.fromEntries(CONTRACT_MILESTONE_STATUSES.map((s) => [s, gigOrderStatusFor(s)])), expected);
  });
});

// ─── Service lifecycle ──────────────────────────────────────────────────────

function servicesSetup(routes: Route[]) {
  const db = fakeDb(routes);
  const n = fakeNotifications();
  const mail = fakeEmail();
  return { ...db, sent: n.sent, queued: mail.queued, svc: new ServicesService(db.pool, n.svc, mail.svc) };
}

const serviceDto = { title: 'Security audit', category: 'Other', summary: 'We audit', description: 'Details', tags: ['a', 'A', 'b'] };

describe('ServicesService lifecycle', () => {
  it('creates a draft with a unique slug and de-duplicated tags', async () => {
    const t = servicesSetup([
      [/COUNT\(\*\) AS n FROM services/, [{ n: '0' }]],
      [/INSERT INTO services/, (p) => [serviceRow({ id: p[0], slug: p[3], tags: p[7] })]],
    ]);
    const out = await t.svc.create(serviceDto, expert);
    assert.equal(out.status, 'draft');
    assert.match(out.slug, /^security-audit-[0-9a-z]{8}$/);
    assert.deepEqual(out.tags, ['a', 'b']);
  });

  it('caps the number of services per expert', async () => {
    const t = servicesSetup([[/COUNT\(\*\) AS n FROM services/, [{ n: '20' }]]]);
    await assert.rejects(t.svc.create(serviceDto, expert), status(409));
  });

  for (const [from, ok] of [['draft', true], ['rejected', true], ['paused', true], ['pending', false], ['published', false]] as const) {
    it(`editing a '${from}' service is ${ok ? 'allowed (and returns it to draft)' : 'refused'}`, async () => {
      const t = servicesSetup([
        [/FOR UPDATE/, [serviceRow({ status: from })]],
        [/UPDATE services/, [serviceRow({ status: 'draft' })]],
      ]);
      if (ok) {
        const out = await t.svc.update('SVC-1', serviceDto, expert);
        assert.equal(out.status, 'draft');
        assert.match(t.log[t.index(/UPDATE services/)].sql, /status = 'draft'/);
      } else {
        await assert.rejects(t.svc.update('SVC-1', serviceDto, expert), status(409));
      }
    });
  }

  it("refuses to touch someone else's service", async () => {
    const t = servicesSetup([[/FOR UPDATE/, [serviceRow({ expert_id: 'someone-else' })]]]);
    await assert.rejects(t.svc.update('SVC-1', serviceDto, expert), status(403));
    await assert.rejects(servicesSetup([]).svc.update('SVC-X', serviceDto, expert), status(404));
  });

  const pkgDto = (tier: 'basic' | 'standard' | 'premium', over = {}) => ({
    tier, name: tier, price: 100, deliveryDays: 3, revisions: 1, features: ['x'], ...over,
  });

  it('replaces the package set: upserts per tier, drops the others, back to draft', async () => {
    const t = servicesSetup([
      [/FOR UPDATE/, [serviceRow()]],
      [/UPDATE services/, [serviceRow()]],
      [/SELECT \* FROM service_packages/, [packageRow()]],
    ]);
    await t.svc.setPackages('SVC-1', { packages: [pkgDto('basic'), pkgDto('premium', { price: 900 })] }, expert);
    assert.equal(t.all(/INSERT INTO service_packages/).length, 2);
    assert.deepEqual(t.log[t.index(/DELETE FROM service_packages/)].params, ['SVC-1', ['basic', 'premium']]);
    assert.match(t.all(/INSERT INTO service_packages/)[0].sql, /active = TRUE/, 're-adding a tier reactivates it');
    assert.match(t.all(/INSERT INTO service_packages/)[0].sql, /ON CONFLICT \(service_id, tier\)/);
  });

  it('rejects an invalid package set before touching the database, and a tier that has orders cannot be dropped', async () => {
    const t = servicesSetup([]);
    await assert.rejects(t.svc.setPackages('SVC-1', { packages: [pkgDto('basic'), pkgDto('basic')] }, expert), status(400));
    await assert.rejects(t.svc.setPackages('SVC-1', { packages: [pkgDto('basic', { price: 0 })] }, expert), status(400));
    assert.equal(t.log.length, 0);
  });

  it('removing a tier that has orders deactivates it (no FK error); one without orders is deleted', async () => {
    const t = servicesSetup([
      [/FOR UPDATE/, [serviceRow()]],
      [/UPDATE services/, [serviceRow()]],
    ]);
    await t.svc.setPackages('SVC-1', { packages: [pkgDto('basic')] }, expert);
    const del = t.all(/DELETE FROM service_packages/);
    assert.equal(del.length, 1);
    assert.match(del[0].sql, /NOT EXISTS \(SELECT 1 FROM gig_orders o WHERE o\.package_id = sp\.id\)/, 'only tiers without orders are deleted');
    const off = t.all(/UPDATE service_packages SET active = FALSE/);
    assert.equal(off.length, 1);
    assert.match(off[0].sql, /tier <> ALL/);
    assert.deepEqual(off[0].params, ['SVC-1', ['basic']]);
    assert.ok(t.index(/DELETE FROM service_packages/) < t.index(/SET active = FALSE/));
  });

  it('only active packages are read for the owner, the detail page and the submit count', async () => {
    const t = servicesSetup([
      [/FOR UPDATE/, [serviceRow()]],
      [/SELECT \* FROM service_packages/, [packageRow()]],
      [/UPDATE services/, [serviceRow()]],
    ]);
    await t.svc.update('SVC-1', serviceDto, expert);
    assert.match(t.log[t.index(/SELECT \* FROM service_packages/)].sql, /AND active/);
  });

  const submitRoutes = (over: { service?: Record<string, unknown>; profile?: string | null; packages?: unknown[] } = {}): Route[] => [
    [/FROM services WHERE id = \$1 FOR UPDATE/, [serviceRow(over.service)]],
    [/FROM expert_profiles WHERE user_id/, over.profile === null ? [] : [{ status: over.profile ?? 'approved' }]],
    [/SELECT \* FROM service_packages/, over.packages ?? [packageRow()]],
    [/UPDATE services SET status = 'pending'/, [serviceRow({ status: 'pending' })]],
    [/role = 'Admin'/, [{ id: 'adm-1' }, { id: 'adm-2' }]],
  ];

  it('submits for review: pending, admins notified', async () => {
    const t = servicesSetup(submitRoutes());
    const out = await t.svc.submit('SVC-1', expert);
    assert.equal(out.status, 'pending');
    assert.deepEqual(t.sent.map((s) => s.userId), ['adm-1', 'adm-2']);
    assert.equal(t.sent[0].link, '/platform/service-approvals');
  });

  it('only approved experts may submit', async () => {
    for (const profile of ['draft', 'pending', 'rejected', 'rework', null]) {
      await assert.rejects(servicesSetup(submitRoutes({ profile })).svc.submit('SVC-1', expert), status(403), String(profile));
    }
  });

  it('needs a package, a summary and a description; and a draft or rejected service', async () => {
    await assert.rejects(servicesSetup(submitRoutes({ packages: [] })).svc.submit('SVC-1', expert), status(400));
    await assert.rejects(servicesSetup(submitRoutes({ service: { summary: '' } })).svc.submit('SVC-1', expert), status(400));
    await assert.rejects(servicesSetup(submitRoutes({ service: { description: ' ' } })).svc.submit('SVC-1', expert), status(400));
    for (const s of ['pending', 'published', 'paused']) {
      await assert.rejects(servicesSetup(submitRoutes({ service: { status: s } })).svc.submit('SVC-1', expert), status(409), s);
    }
    const t = servicesSetup(submitRoutes({ service: { status: 'rejected' } }));
    assert.equal((await t.svc.submit('SVC-1', expert)).status, 'pending');
  });

  it('pauses a published service and resumes a paused one, nothing else', async () => {
    const pause = servicesSetup([
      [/FOR UPDATE/, [serviceRow({ status: 'published' })]],
      [/UPDATE services SET status/, [serviceRow({ status: 'paused' })]],
    ]);
    assert.equal((await pause.svc.pause('SVC-1', expert)).status, 'paused');
    await assert.rejects(servicesSetup([[/FOR UPDATE/, [serviceRow({ status: 'draft' })]]]).svc.pause('SVC-1', expert), status(409));

    const resume = servicesSetup([
      [/FROM services WHERE id = \$1 FOR UPDATE/, [serviceRow({ status: 'paused' })]],
      [/FROM expert_profiles/, [{ status: 'approved' }]],
      [/UPDATE services SET status/, [serviceRow({ status: 'published' })]],
    ]);
    assert.equal((await resume.svc.resume('SVC-1', expert)).status, 'published');
    const lost = servicesSetup([
      [/FROM services WHERE id = \$1 FOR UPDATE/, [serviceRow({ status: 'paused' })]],
      [/FROM expert_profiles/, [{ status: 'rejected' }]],
    ]);
    await assert.rejects(lost.svc.resume('SVC-1', expert), status(403));
  });
});

describe('ServicesService admin approval', () => {
  const routes = (from: string): Route[] => [
    [/FROM services WHERE id = \$1 FOR UPDATE/, [serviceRow({ status: from })]],
    [/UPDATE services s SET status/, (p) => [serviceRow({ status: p[1], admin_note: p[2] })]],
    [/SELECT \* FROM service_packages/, [packageRow()]],
  ];

  it('publishes a pending service: audited, expert notified and emailed in the same transaction', async () => {
    const t = servicesSetup(routes('pending'));
    const out = await t.svc.setStatus('SVC-1', { status: 'published' }, admin);
    assert.equal(out.status, 'published');
    const commit = t.index(/^COMMIT$/);
    assert.ok(t.index(/INSERT INTO audit_log/) < commit);
    assert.equal(t.log[t.index(/INSERT INTO audit_log/)].params[3], 'Approved service');
    assert.deepEqual(t.sent.map((s) => s.userId), ['exp-1']);
    assert.deepEqual(t.queued.map((q) => [q.template, q.to, q.data.decision]), [['service-decision', 'eshan@example.com', 'published']]);
  });

  it('rejecting needs a note of 5+ characters', async () => {
    await assert.rejects(servicesSetup(routes('pending')).svc.setStatus('SVC-1', { status: 'rejected' }, admin), status(400));
    await assert.rejects(servicesSetup(routes('pending')).svc.setStatus('SVC-1', { status: 'rejected', note: 'no' }, admin), status(400));
    const t = servicesSetup(routes('pending'));
    const out = await t.svc.setStatus('SVC-1', { status: 'rejected', note: 'Please add detail' }, admin);
    assert.equal(out.adminNote, 'Please add detail');
  });

  it('only decides what can be decided: drafts cannot be published, live ones can be taken down', async () => {
    await assert.rejects(servicesSetup(routes('draft')).svc.setStatus('SVC-1', { status: 'published' }, admin), status(409));
    await assert.rejects(servicesSetup(routes('rejected')).svc.setStatus('SVC-1', { status: 'published' }, admin), status(409));
    await assert.rejects(servicesSetup(routes('published')).svc.setStatus('SVC-1', { status: 'published' }, admin), status(409));
    const down = servicesSetup(routes('published'));
    assert.equal((await down.svc.setStatus('SVC-1', { status: 'rejected', note: 'Policy breach' }, admin)).status, 'rejected');
    await assert.rejects(servicesSetup([[/FOR UPDATE/, []]]).svc.setStatus('SVC-X', { status: 'published' }, admin), status(404));
  });

  it('lists the pending queue by default', async () => {
    const t = servicesSetup([[/FROM services s JOIN user_accounts/, [serviceRow({ status: 'pending' })]]]);
    const items = await t.svc.adminList({});
    assert.equal(t.log[0].params[0], 'pending');
    assert.equal(items[0].expertName, 'Eshan Expert');
  });
});

// ─── Public catalogue ───────────────────────────────────────────────────────

describe('public listing', () => {
  it('only asks for published services of listable experts, binds every filter, and selects no email', () => {
    const q = buildServiceSearch({ q: "'; DROP TABLE services; --", category: 'Other', minPrice: 100, maxPrice: 900, sort: 'price_asc', page: '2', pageSize: '10' });
    assert.match(q.text, /s\.status = 'published'/);
    assert.match(q.text, /p\.status = 'approved'/);
    assert.ok(!/DROP TABLE|Other|\b900\b/.test(q.text), 'user input never appears in the SQL text');
    assert.deepEqual(q.values.slice(0, 4), ["'; DROP TABLE services; --", 'Other', 100, 900]);
    assert.ok(q.values.includes(10) && q.values.includes(10), 'page size and offset are bound');
    assert.ok(!/email|admin_note|expert_id AS/.test(q.text.replace(/s\.expert_id/g, '')), 'no email or admin note column');
    assert.match(q.text, /ORDER BY pk\.price ASC/);
    assert.match(q.text, /WHERE sp\.service_id = s\.id AND sp\.active ORDER BY sp\.price/, 'the catalogue price ignores inactive packages');
  });

  it('whitelists the sort and rejects an inverted price range', () => {
    const q = buildServiceSearch({ sort: 'price_asc; DROP TABLE x' as never });
    assert.ok(!/DROP/.test(q.text));
    assert.throws(() => buildServiceSearch({ minPrice: 10, maxPrice: 5 }), status(400));
  });

  it('returns cards with no email, expert id or status', async () => {
    const t = servicesSetup([[/FROM services s/, [{ ...serviceRow({ status: 'published' }), from_price: '5000.00', from_days: 5, expert_rating: '4.5', total: '1' }]]]);
    const page = await t.svc.list({});
    assert.equal(page.total, 1);
    const card = page.items[0];
    assert.equal(card.expertName, 'Eshan E.');
    assert.equal(card.fromPrice, 5000);
    const json = JSON.stringify(card);
    assert.ok(!/email|eshan@|exp-1|expertId|status|admin/i.test(json), json);
  });

  it('never returns a draft: a non-owner gets 404 for an unpublished service, the owner and admins can preview it', async () => {
    const route: Route[] = [
      [/WHERE s\.slug = \$1/, [serviceRow({ status: 'draft' })]],
      [/SELECT \* FROM service_packages/, [packageRow()]],
    ];
    await assert.rejects(servicesSetup(route).svc.detail('security-audit-1', null), status(404));
    await assert.rejects(servicesSetup(route).svc.detail('security-audit-1', other), status(404));
    const owner = await servicesSetup(route).svc.detail('security-audit-1', expert);
    assert.equal(owner.isOwner, true);
    assert.equal((await servicesSetup(route).svc.detail('security-audit-1', admin)).isOwner, false);
    const published = await servicesSetup([
      [/WHERE s\.slug = \$1/, [serviceRow({ status: 'published' })]],
      [/SELECT \* FROM service_packages/, [packageRow(), packageRow({ id: 'PKG-2', tier: 'premium', price: '9000.00' })]],
    ]).svc.detail('security-audit-1', null);
    assert.deepEqual(published.packages.map((p) => p.tier), ['basic', 'premium']);
    assert.ok(!/email/i.test(JSON.stringify(published)));
  });
});

// ─── Orders ─────────────────────────────────────────────────────────────────

const orderRow = (over: Record<string, unknown> = {}) => ({
  id: 'ORD-1', service_id: 'SVC-1', package_id: 'PKG-1', buyer_id: 'buyer-1', expert_id: 'exp-1',
  requirements: 'Audit our repo', price: '5000.00', delivery_days: 5, revisions: 2, contract_id: 'CT-1',
  status: 'in_progress', due_at: null, delivered_at: null, accepted_terms_at: new Date(), created_at: new Date(),
  service_title: 'Security audit', service_slug: 'security-audit-1', package_name: 'Basic', package_tier: 'basic',
  buyer_name: 'Bina Buyer', expert_name: 'Eshan Expert', contract_status: 'active', milestone_status: 'funded',
  revisions_used: 0, reviewed: false, ...over,
});
const MID = '11111111-1111-4111-8111-111111111111';

function ordersSetup(routes: Route[]) {
  const db = fakeDb(routes);
  const n = fakeNotifications();
  const calls: { method: string; args: unknown[]; hooks?: MilestoneHooks }[] = [];
  const contracts = new Proxy({}, {
    get: (_t, method: string) => async (...args: unknown[]) => {
      calls.push({ method, args, hooks: args.find((a) => a && typeof a === 'object' && ('before' in a || 'after' in a)) as MilestoneHooks | undefined });
      return {};
    },
  }) as unknown as ContractsService;
  return { ...db, sent: n.sent, calls, svc: new GigOrdersService(db.pool, contracts, n.svc) };
}

const orderRoutes = (order: Record<string, unknown> = {}): Route[] => [
  [/FROM gig_orders o\s+JOIN services s/, [orderRow(order)]],
  [/SELECT id FROM contract_milestones WHERE contract_id/, [{ id: MID }]],
  [/FROM gig_deliveries/, []],
];

describe('GigOrdersService.create', () => {
  const pkg = (over: Record<string, unknown> = {}) => ({
    package_id: 'PKG-1', service_id: 'SVC-1', service_title: 'Security audit', expert_id: 'exp-1', status: 'published',
    package_name: 'Basic', price: '5000.00', delivery_days: 5, revisions: 2, expert_listable: true, ...over,
  });
  const createRoutes = (over: Record<string, unknown> = {}): Route[] => [
    [/FROM service_packages sp\s+JOIN services s/, [pkg(over)]],
    ...orderRoutes(),
  ];
  const dto = { packageId: 'PKG-1', requirements: 'Audit our repository please', acceptTerms: true as const };

  it('creates the order, an active gig contract and its single milestone in one transaction', async () => {
    const t = ordersSetup(createRoutes());
    const out = await t.svc.create(dto, buyer);
    assert.equal(out.contractId, 'CT-1');
    const begin = t.index(/^BEGIN$/);
    const commit = t.index(/^COMMIT$/);
    const order = t.index(/INSERT INTO gig_orders/);
    const contract = t.index(/INSERT INTO contracts/);
    const milestone = t.index(/INSERT INTO contract_milestones/);
    const link = t.index(/UPDATE gig_orders SET contract_id/);
    assert.ok(begin < order && order < contract && contract < milestone && milestone < link && link < commit);
    // price, days and revisions are snapshotted from the package, never taken from the request
    const o = t.log[order].params;
    assert.deepEqual([o[3], o[4], o[6], o[7], o[8]], ['buyer-1', 'exp-1', 5000, 5, 2]);
    assert.match(t.log[order].sql, /accepted_terms_at/);
    const c = t.log[contract];
    assert.match(c.sql, /NULL, NULL, \$2, \$3/);
    assert.match(c.sql, /'fixed'/);
    assert.match(c.sql, /'active', 'gig'/);
    assert.equal(c.params[2], 'Security audit');
    assert.equal(t.log[milestone].params[2], 5000);
    assert.deepEqual(t.sent.map((s) => s.userId), ['exp-1']);
  });

  it('refuses ordering your own service', async () => {
    const t = ordersSetup(createRoutes());
    await assert.rejects(t.svc.create(dto, { ...buyer, id: 'exp-1' } as User), status(403));
    assert.ok(t.index(/INSERT INTO gig_orders/) < 0);
  });

  it('refuses unpublished services, unknown packages and experts who are no longer approved', async () => {
    for (const s of ['draft', 'pending', 'paused', 'rejected']) {
      await assert.rejects(ordersSetup(createRoutes({ status: s })).svc.create(dto, buyer), status(404), s);
    }
    await assert.rejects(ordersSetup([]).svc.create(dto, buyer), status(404));
    await assert.rejects(ordersSetup(createRoutes({ expert_listable: false })).svc.create(dto, buyer), status(409));
  });

  it('applies the public-expert account condition (active, not banned / suspended / deleted) and only active packages', async () => {
    const t = ordersSetup(createRoutes());
    await t.svc.create(dto, buyer);
    const sql = t.log[t.index(/FROM service_packages sp\s+JOIN services s/)].sql;
    assert.ok(sql.includes(PUBLIC_EXPERT_SQL), 'reuses the shared catalogue fragment');
    assert.match(PUBLIC_EXPERT_SQL, /account_status = 'active'[\s\S]*deleted_at IS NULL[\s\S]*is_banned = FALSE[\s\S]*is_suspended/);
    assert.match(sql, /WHERE sp\.id = \$1 AND sp\.active/);
  });

  it('a suspended, banned or deleted expert (not listable) can not be ordered from: 409, nothing written', async () => {
    for (const why of ['suspended', 'banned', 'deleted']) {
      const t = ordersSetup(createRoutes({ expert_listable: false }));
      await assert.rejects(t.svc.create(dto, buyer), (e: HttpException) => e.getStatus() === 409 && /not available right now/.test(e.message), why);
      assert.ok(t.index(/INSERT INTO gig_orders/) < 0, why);
    }
  });

  it('an inactive (removed) package is not found, so it can not be ordered', async () => {
    const t = ordersSetup([[/FROM service_packages sp\s+JOIN services s/, []]]);
    await assert.rejects(t.svc.create(dto, buyer), status(404));
  });

  it('requires accepting the terms and real requirements', async () => {
    await assert.rejects(ordersSetup(createRoutes()).svc.create({ ...dto, acceptTerms: false as never }, buyer), status(400));
    await assert.rejects(ordersSetup(createRoutes()).svc.create({ ...dto, requirements: 'short' }, buyer), status(400));
  });

  it('writes nothing when the contract insert fails (rolled back)', async () => {
    const t = ordersSetup([
      [/FROM service_packages sp\s+JOIN services s/, [pkg()]],
      [/INSERT INTO contracts/, () => ({ error: new Error('boom') })],
    ]);
    await assert.rejects(t.svc.create(dto, buyer));
    assert.equal(t.log.at(-1)?.sql, 'ROLLBACK');
    assert.ok(t.index(/^COMMIT$/) < 0);
  });
});

describe('GigOrdersService delivery workflow', () => {
  it('deliver: only the expert, only a funded order, https links only; goes through submitMilestone with the delivery row in its transaction', async () => {
    const t = ordersSetup(orderRoutes());
    await t.svc.deliver('ORD-1', { note: 'All done', links: ['https://example.com/report'] }, expert);
    const call = t.calls.find((c) => c.method === 'submitMilestone');
    assert.deepEqual(call?.args.slice(0, 3), ['CT-1', MID, 'All done\n\nLinks:\nhttps://example.com/report']);
    assert.ok(call?.hooks?.after, 'the delivery row is written by the hook, inside the milestone transaction');
    const inTx: string[] = [];
    await call?.hooks?.after?.({ query: async (sql: string) => { inTx.push(sql); return { rows: [] }; } } as never);
    assert.match(inTx[0], /INSERT INTO gig_deliveries/);

    await assert.rejects(t.svc.deliver('ORD-1', { note: 'x' }, buyer), status(403));
    await assert.rejects(t.svc.deliver('ORD-1', { note: 'x', links: ['http://example.com'] }, expert), status(400));
    for (const s of ['awaiting_payment', 'delivered', 'completed', 'cancelled']) {
      await assert.rejects(ordersSetup(orderRoutes({ status: s })).svc.deliver('ORD-1', { note: 'x' }, expert), status(409), s);
    }
    // a revision request can be answered with a new delivery
    await ordersSetup(orderRoutes({ status: 'revision_requested' })).svc.deliver('ORD-1', { note: 'fixed' }, expert);
  });

  it('request-revision: only the buyer, only when delivered, limited by the package revisions', async () => {
    const t = ordersSetup(orderRoutes({ status: 'delivered', milestone_status: 'submitted' }));
    await t.svc.requestRevision('ORD-1', { note: 'More detail' }, buyer);
    assert.equal(t.calls.find((c) => c.method === 'requestRevision')?.args[3], buyer);

    await assert.rejects(t.svc.requestRevision('ORD-1', { note: 'x' }, expert), status(403));
    await assert.rejects(ordersSetup(orderRoutes({ status: 'in_progress' })).svc.requestRevision('ORD-1', { note: 'x' }, buyer), status(409));
    const used = ordersSetup(orderRoutes({ status: 'delivered', revisions: 2, revisions_used: 2 }));
    await assert.rejects(used.svc.requestRevision('ORD-1', { note: 'x' }, buyer), status(409));
    assert.equal(used.calls.length, 0);

    // The limit is re-checked under the milestone lock (a racing request).
    const hook = t.calls.find((c) => c.method === 'requestRevision')?.hooks?.before;
    const client = (revisions: number) => ({ query: async () => ({ rows: [{ revisions }] }) }) as never;
    await hook?.(client(2), { revision_count: 1 } as never);
    await assert.rejects(hook?.(client(2), { revision_count: 2 } as never) ?? Promise.reject(new HttpException('no hook', 500)), status(409));
    await assert.rejects(hook?.(client(0), { revision_count: 0 } as never) ?? Promise.reject(new HttpException('no hook', 500)), status(409));
  });

  it('accept: accepts then releases through the contract; a retry after a failed release only releases', async () => {
    const t = ordersSetup(orderRoutes({ status: 'delivered', milestone_status: 'submitted' }));
    await t.svc.accept('ORD-1', buyer);
    assert.deepEqual(t.calls.map((c) => c.method).filter((m) => /Milestone/.test(m)), ['acceptMilestone', 'releaseMilestone']);

    const retry = ordersSetup(orderRoutes({ status: 'delivered', milestone_status: 'accepted' }));
    await retry.svc.accept('ORD-1', buyer);
    assert.deepEqual(retry.calls.map((c) => c.method).filter((m) => /Milestone/.test(m)), ['releaseMilestone']);

    await assert.rejects(t.svc.accept('ORD-1', expert), status(403));
    await assert.rejects(ordersSetup(orderRoutes({ milestone_status: 'funded' })).svc.accept('ORD-1', buyer), status(409));
    await assert.rejects(ordersSetup(orderRoutes({ milestone_status: 'released' })).svc.accept('ORD-1', buyer), status(409));
  });

  it('cancel: the buyer before payment only (cancels the contract); after payment use a dispute', async () => {
    const t = ordersSetup(orderRoutes({ status: 'awaiting_payment', milestone_status: 'pending' }));
    await t.svc.cancel('ORD-1', buyer);
    assert.deepEqual(t.calls.map((c) => c.method), ['cancel']);
    assert.equal(t.calls[0].args[0], 'CT-1');
    await assert.rejects(t.svc.cancel('ORD-1', expert), status(403));
    await assert.rejects(t.svc.cancel('ORD-1', other), status(403));
    for (const s of ['in_progress', 'delivered', 'revision_requested', 'completed', 'cancelled']) {
      const x = ordersSetup(orderRoutes({ status: s }));
      await assert.rejects(x.svc.cancel('ORD-1', buyer), status(409), s);
      assert.equal(x.calls.length, 0);
    }
  });

  it('shows an order to its parties and admins only', async () => {
    const t = ordersSetup(orderRoutes());
    for (const u of [buyer, expert, admin]) assert.equal((await t.svc.findOne('ORD-1', u)).id, 'ORD-1');
    await assert.rejects(t.svc.findOne('ORD-1', other), status(403));
    await assert.rejects(ordersSetup([]).svc.findOne('ORD-X', buyer), status(404));
  });

  it("lists only the caller's orders, admins all", async () => {
    const t = ordersSetup([[/FROM gig_orders o/, [orderRow()]]]);
    await t.svc.findAll(buyer, {}, { page: 1, pageSize: 20, offset: 0 });
    assert.match(t.log[0].sql, /o\.buyer_id = \$1 OR o\.expert_id = \$1/);
    const a = ordersSetup([[/FROM gig_orders o/, [orderRow()]]]);
    await a.svc.findAll(admin, { status: 'completed' }, { page: 1, pageSize: 20, offset: 0 });
    assert.ok(!/o\.buyer_id = /.test(a.log[0].sql));
    assert.deepEqual(a.log[0].params, ['completed', 20, 0]);
  });
});

describe('GigOrdersService.review', () => {
  const routes = (o: Record<string, unknown> = {}): Route[] => [
    [/FROM gig_orders o JOIN services s ON s\.id = o\.service_id\s+WHERE o\.id = \$1 FOR UPDATE/, [{
      buyer_id: 'buyer-1', expert_id: 'exp-1', service_id: 'SVC-1', status: 'completed', title: 'Security audit', ...o,
    }]],
    ...orderRoutes({ status: 'completed', reviewed: true }),
  ];

  it('stores the review against the order (no project) and recomputes the service and expert ratings in the same transaction', async () => {
    const t = ordersSetup(routes());
    await t.svc.review('ORD-1', { rating: 5, comment: 'Great' }, buyer);
    const commit = t.index(/^COMMIT$/);
    const insert = t.index(/INSERT INTO reviews/);
    assert.match(t.log[insert].sql, /project_id, gig_order_id/);
    assert.match(t.log[insert].sql, /VALUES \(NULL, \$1/);
    assert.ok(insert < t.index(/UPDATE services s/) && t.index(/UPDATE services s/) < t.index(/UPDATE expert_profiles p/));
    assert.ok(t.index(/UPDATE expert_profiles p/) < commit);
    assert.deepEqual(t.sent.map((s) => s.userId), ['exp-1']);
  });

  it('only the buyer, only once completed, only once', async () => {
    await assert.rejects(ordersSetup(routes()).svc.review('ORD-1', { rating: 5 }, expert), status(403));
    await assert.rejects(ordersSetup(routes({ status: 'delivered' })).svc.review('ORD-1', { rating: 5 }, buyer), status(409));
    const dup = ordersSetup([
      ...routes(),
      [/INSERT INTO reviews/, () => ({ error: Object.assign(new Error('dup'), { code: '23505' }) })],
    ]);
    await assert.rejects(dup.svc.review('ORD-1', { rating: 5 }, buyer), status(409));
    assert.ok(dup.index(/UPDATE services s/) < 0);
  });
});

// ─── Order views ────────────────────────────────────────────────────────────

describe('order mapper: auto-accept date and overdue flag', () => {
  const DAY = 86_400_000;
  it('delivered orders show when they auto-accept (delivered + 7 days); a dispute or other status shows none', () => {
    const deliveredAt = new Date(Date.now() - 2 * DAY);
    const o = mapOrder(orderRow({ status: 'delivered', milestone_status: 'submitted', delivered_at: deliveredAt }) as never);
    assert.equal(o.autoAcceptAt, new Date(deliveredAt.getTime() + 7 * DAY).toISOString());
    assert.equal(mapOrder(orderRow({ status: 'delivered', milestone_status: 'submitted', contract_status: 'disputed', delivered_at: deliveredAt }) as never).autoAcceptAt, null);
    assert.equal(mapOrder(orderRow({ status: 'completed', milestone_status: 'released', delivered_at: deliveredAt }) as never).autoAcceptAt, null);
  });

  it('flags a funded order past due_at as overdue; a delivered or on-time one is not', () => {
    const past = new Date(Date.now() - DAY);
    const future = new Date(Date.now() + DAY);
    assert.equal(mapOrder(orderRow({ due_at: past }) as never).overdue, true);
    assert.equal(mapOrder(orderRow({ due_at: past, status: 'revision_requested', milestone_status: 'revision_requested' }) as never).overdue, true);
    assert.equal(mapOrder(orderRow({ due_at: future }) as never).overdue, false);
    assert.equal(mapOrder(orderRow({ due_at: past, status: 'delivered', milestone_status: 'submitted' }) as never).overdue, false);
  });
});

// ─── Gig sweep ──────────────────────────────────────────────────────────────

describe('GigSweepService', () => {
  const sweepOrder = (over: Record<string, unknown> = {}) => ({
    id: 'ORD-1', contract_id: 'CT-1', milestone_id: MID, service_title: 'Security audit',
    buyer_id: 'buyer-1', buyer_email: 'bina@example.com', buyer_first_name: 'Bina',
    expert_id: 'exp-1', expert_email: 'eshan@example.com', expert_first_name: 'Eshan', ...over,
  });

  /** One shared "server": the advisory lock is held by at most one client; statements are matched by routes. */
  function sweepDb(routes: Route[], opts: { hold?: Promise<void> } = {}) {
    const log: { sql: string; params: unknown[]; client: number }[] = [];
    let holder: number | null = null;
    let clients = 0;
    let released = 0;
    const pool = {
      connect: async () => {
        const id = ++clients;
        return {
          release: () => { released++; },
          query: async (sql: string, params: unknown[] = []) => {
            log.push({ sql, params, client: id });
            if (/pg_try_advisory_lock/.test(sql)) {
              if (holder === null) { holder = id; return { rows: [{ locked: true }] }; }
              return { rows: [{ locked: false }] };
            }
            if (/pg_advisory_unlock/.test(sql)) { if (holder === id) holder = null; return { rows: [] }; }
            if (opts.hold && /FROM gig_orders o/.test(sql)) await opts.hold;
            for (const [re, reply] of routes) {
              if (re.test(sql)) {
                const out = typeof reply === 'function' ? reply(params) : reply;
                return { rows: out as unknown[], rowCount: (out as unknown[]).length };
              }
            }
            return { rows: [], rowCount: 0 };
          },
        };
      },
    } as unknown as Pool;
    return { pool, log, holder: () => holder, released: () => released, all: (re: RegExp) => log.filter((q) => re.test(q.sql)) };
  }

  const config = (enabled?: string) => ({ get: (k: string) => (k === 'GIG_SWEEP_ENABLED' ? enabled : undefined) }) as never;
  function make(db: ReturnType<typeof sweepDb>, accept: (c: string, m: string, r: string) => Promise<boolean> = async () => true) {
    const n = fakeNotifications();
    const e = fakeEmail();
    const accepted: string[][] = [];
    const contracts = { autoAcceptAndRelease: async (c: string, m: string, r: string) => { accepted.push([c, m, r]); return accept(c, m, r); } } as unknown as ContractsService;
    return { sent: n.sent, queued: e.queued, accepted, svc: new GigSweepService(db.pool, contracts, n.svc, e.svc, config()) };
  }
  const remindRoute: Route = [/o\.reminder_sent_at IS NULL AND o\.delivered_at/, [sweepOrder()]];
  const acceptRoute: Route = [/o\.delivered_at <= NOW\(\) - make_interval\(days => \$1\)\s*ORDER/, [sweepOrder()]];
  const overdueRoute: Route = [/o\.overdue_notified_at IS NULL\s+ORDER/, [sweepOrder()]];
  const adminsRoute: Route = [/role = 'Admin'/, [{ id: 'adm-1' }]];

  it('reminds the buyer once (in-app + email) 5 days after delivery, and records reminder_sent_at', async () => {
    let marked = false;
    const db = sweepDb([
      remindRoute, adminsRoute,
      [/UPDATE gig_orders SET reminder_sent_at/, () => (marked ? [] : ((marked = true), [{ id: 'ORD-1' }]))],
    ]);
    const t = make(db);
    assert.deepEqual(await t.svc.sweep(), { reminded: 1, accepted: 0, overdue: 0 });
    const sel = db.all(/o\.reminder_sent_at IS NULL AND o\.delivered_at/)[0];
    assert.match(sel.sql, /m\.status = 'submitted' AND c\.status <> 'disputed'/);
    assert.deepEqual(sel.params, [5, 7]);
    assert.deepEqual(t.sent.map((s) => s.userId), ['buyer-1']);
    assert.match(t.sent[0].text, /accepted automatically in 2 days/);
    assert.equal(t.queued.length, 1);
    assert.equal(t.queued[0].template, 'gig-delivery-reminder');
    assert.deepEqual(t.queued[0].data, { firstName: 'Bina', serviceTitle: 'Security audit', daysLeft: 2, path: '/platform/orders/ORD-1' });
    // the guarded UPDATE finds the order already marked next round: nothing more is sent
    assert.deepEqual(await t.svc.sweep(), { reminded: 0, accepted: 0, overdue: 0 });
    assert.equal(t.sent.length, 1);
    assert.equal(t.queued.length, 1);
    assert.match(db.all(/UPDATE gig_orders SET reminder_sent_at/)[0].sql, /reminder_sent_at IS NULL/);
  });

  it('auto-accepts orders delivered 7+ days ago through the contract and tells both parties', async () => {
    const db = sweepDb([acceptRoute]);
    const t = make(db);
    assert.deepEqual(await t.svc.sweep(), { reminded: 0, accepted: 1, overdue: 0 });
    assert.equal(t.accepted.length, 1);
    assert.deepEqual(t.accepted[0].slice(0, 2), ['CT-1', MID]);
    assert.match(t.accepted[0][2], /7 days/);
    const sel = db.all(/o\.delivered_at <= NOW\(\) - make_interval\(days => \$1\)\s*ORDER/)[0];
    assert.match(sel.sql, /m\.status = 'submitted' AND c\.status <> 'disputed'/, 'a disputed contract is never auto-accepted');
    assert.deepEqual(sel.params, [7]);
    assert.deepEqual(t.sent.map((s) => s.userId).sort(), ['buyer-1', 'exp-1']);
    assert.deepEqual(t.queued.map((q) => [q.template, q.to]).sort(), [['gig-auto-accepted', 'bina@example.com'], ['gig-auto-accepted', 'eshan@example.com']]);
    assert.deepEqual(t.queued.map((q) => q.data.audience).sort(), ['buyer', 'expert']);
  });

  it('notifies nobody when the contract says the order is no longer acceptable (disputed or already accepted)', async () => {
    const db = sweepDb([acceptRoute]);
    const t = make(db, async () => false);
    assert.deepEqual(await t.svc.sweep(), { reminded: 0, accepted: 0, overdue: 0 });
    assert.equal(t.sent.length, 0);
    assert.equal(t.queued.length, 0);
  });

  it('one failing order does not stop the others', async () => {
    const db = sweepDb([[/o\.delivered_at <= NOW\(\) - make_interval\(days => \$1\)\s*ORDER/, [sweepOrder({ id: 'ORD-1', contract_id: 'CT-1' }), sweepOrder({ id: 'ORD-2', contract_id: 'CT-2' })]]]);
    const t = make(db, async (c) => { if (c === 'CT-1') throw new Error('boom'); return true; });
    assert.equal((await t.svc.sweep())?.accepted, 1);
    assert.equal(t.accepted.length, 2);
  });

  it('flags a funded order past due once: expert, buyer and admins are told, overdue_notified_at is set, nothing is cancelled', async () => {
    let marked = false;
    const db = sweepDb([
      overdueRoute, adminsRoute,
      [/UPDATE gig_orders SET overdue_notified_at/, () => (marked ? [] : ((marked = true), [{ id: 'ORD-1' }]))],
    ]);
    const t = make(db);
    assert.deepEqual(await t.svc.sweep(), { reminded: 0, accepted: 0, overdue: 1 });
    const sel = db.all(/o\.overdue_notified_at IS NULL\s+ORDER/)[0];
    assert.match(sel.sql, /m\.status IN \('funded', 'revision_requested'\)/);
    assert.match(sel.sql, /o\.due_at < NOW\(\)/);
    assert.deepEqual(t.sent.map((s) => s.userId), ['exp-1', 'buyer-1', 'adm-1']);
    assert.match(t.sent[1].text, /open a dispute/);
    assert.equal(t.accepted.length, 0);
    assert.equal(db.all(/cancel/i).length, 0);
    await t.svc.sweep();
    assert.equal(t.sent.length, 3, 'a second round notifies nobody again');
  });

  it('a second instance skips the round while the first holds the advisory lock', async () => {
    let finish!: () => void;
    const hold = new Promise<void>((resolve) => { finish = resolve; });
    const db = sweepDb([acceptRoute], { hold });
    const a = make(db);
    const b = make(db);
    const first = a.svc.sweep();
    await new Promise((r) => setImmediate(r));
    assert.equal(await b.svc.sweep(), null);
    finish();
    assert.deepEqual(await first, { reminded: 0, accepted: 1, overdue: 0 });
    assert.equal(b.accepted.length, 0);
    assert.equal(db.log.find((q) => /pg_try_advisory_lock/.test(q.sql))?.params[0], GIG_SWEEP_LOCK_KEY);
    assert.ok(db.all(/pg_advisory_unlock/).length >= 1);
    assert.equal(db.holder(), null);
    assert.equal(db.released(), 2);
  });

  it('does not schedule anything when GIG_SWEEP_ENABLED=false, and clears its timer on shutdown', async () => {
    const db = sweepDb([]);
    const timerOf = (s: GigSweepService) => (s as unknown as { timer: unknown }).timer;
    const off = new GigSweepService(db.pool, {} as never, fakeNotifications().svc, fakeEmail().svc, config('false'));
    off.onApplicationBootstrap();
    assert.equal(timerOf(off), null);
    await off.onApplicationShutdown();
    assert.equal(db.log.length, 0);
    const on = new GigSweepService(db.pool, {} as never, fakeNotifications().svc, fakeEmail().svc, config());
    on.onApplicationBootstrap();
    assert.notEqual(timerOf(on), null);
    await on.onApplicationShutdown();
    assert.equal(timerOf(on), null);
  });
});
