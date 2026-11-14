import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, HttpException } from '@nestjs/common';
import type { User } from '@asteai/types';
import { fakeConfig, fakeDb, fakeEmail } from '../../test-support/fakes';
import { render } from '../email/templates';
import { cleanProspects, columnKey, needsRebalance, normalizeColumns, positionBetween } from '../talent-pools/board';
import { TalentPoolsService } from '../talent-pools/talent-pools.service';
import { readUnsubscribeToken, renderTemplate, sendAfter, unknownVariables, unsubscribeToken } from './outreach-templates';
import { OutreachDispatcher } from './outreach.dispatcher';
import { deliveryOf, OutreachService } from './outreach.service';

const employer = { id: 'e1', role: 'Employer', tenantId: 'T1', firstName: 'Esha', lastName: 'K' } as User;
const SECRET = 'unsub-secret';
const CAMPAIGN = '33333333-3333-4333-8333-333333333333';

describe('Talent CRM board helpers', () => {
  it('positions: between neighbours, before the first, after the last', () => {
    assert.equal(positionBetween(null, null), 1024);
    assert.equal(positionBetween(1024, 2048), 1536);
    assert.equal(positionBetween(null, 1024), 0);
    assert.equal(positionBetween(2048, null), 3072);
    assert.throws(() => positionBetween(5, 5), RangeError);
    assert.equal(needsRebalance(1, 1 + 1e-12), true);
  });

  it('columns: keys from labels, stable when given, unique, 1–12', () => {
    assert.deepEqual(normalizeColumns([{ label: 'Phone screen' }, { key: 'hired', label: 'Hired!' }]),
      [{ key: 'phone_screen', label: 'Phone screen' }, { key: 'hired', label: 'Hired!' }]);
    assert.ok('error' in (normalizeColumns([{ label: 'A' }, { label: 'a' }]) as object));
    assert.ok('error' in (normalizeColumns([]) as object));
    assert.equal(columnKey('  Final Round (2) '), 'final_round_2');
  });

  it('prospects: valid, lowercased, de-duplicated', () => {
    const { valid, invalid } = cleanProspects([
      { email: 'Priya@Example.com', fullName: ' Priya Menon ', tags: ['Go', 'go', ''] },
      { email: 'priya@example.com' },
      { email: 'not-an-email' },
    ]);
    assert.deepEqual(valid, [{ email: 'priya@example.com', fullName: 'Priya Menon', tags: ['go'] }]);
    assert.deepEqual(invalid, ['not-an-email']);
  });

  it('moving a card between two others writes one row at the midpoint', async () => {
    const pool = { id: '11111111-1111-4111-8111-111111111111', tenant_id: 'T1', columns: [{ key: 'sourced', label: 'Sourced' }, { key: 'engaged', label: 'Engaged' }] };
    const db = fakeDb([
      [/FROM ats_talent_pools WHERE id = \$1 AND tenant_id = \$2/, [pool]],
      [/SELECT position, column_key FROM talent_pool_members/, (p) => [{ position: p[0] === 'before' ? 1024 : 2048, column_key: 'engaged' }]],
      [/UPDATE talent_pool_members SET column_key/, (p) => [{ id: p[0], column_key: p[2], position: p[3], email: 'x@y.z', full_name: '', tags: [], notes: '', user_id: null, updated_at: new Date() }]],
    ]);
    const out = await new TalentPoolsService(db.pool).moveMember(employer, pool.id, 'card', { column: 'engaged', beforeId: 'before', afterId: 'after' });
    assert.deepEqual([out.column, out.position], ['engaged', 1536]);
    await assert.rejects(new TalentPoolsService(db.pool).moveMember(employer, pool.id, 'card', { column: 'nope' }), BadRequestException);
  });
});

describe('outreach templates', () => {
  it('fills known variables as plain text and flags unknown ones', () => {
    assert.equal(renderTemplate('Hi {{ firstName }}, {{companyName}} is hiring a {{jobTitle}}', { firstName: 'Priya', companyName: 'Acme', jobTitle: 'SRE' }),
      'Hi Priya, Acme is hiring a SRE');
    assert.equal(renderTemplate('Hi {{firstName}}!', {}), 'Hi !');
    assert.deepEqual(unknownVariables('Hi {{firstname}} from {{companyName}} {{ salary }}'), ['firstname', 'salary']);
  });

  it('spaces messages at the campaign rate', () => {
    const t0 = new Date('2026-11-14T10:00:00Z');
    assert.deepEqual([0, 1, 59, 60, 120].map((i) => sendAfter(t0, i, 60).toISOString().slice(11, 19)),
      ['10:00:00', '10:00:01', '10:00:59', '10:01:00', '10:02:00']);
    assert.equal(sendAfter(t0, 10, 1).toISOString().slice(11, 16), '10:10');
  });

  it('unsubscribe tokens verify, and any tampering is refused', () => {
    const token = unsubscribeToken(SECRET, 'T1', 'Priya@Example.com');
    assert.deepEqual(readUnsubscribeToken(SECRET, token), { tenantId: 'T1', email: 'priya@example.com' });
    const [payload, mac] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ t: 'T2', e: 'priya@example.com' })).toString('base64url');
    assert.equal(readUnsubscribeToken(SECRET, `${forged}.${mac}`), null);
    assert.equal(readUnsubscribeToken('other-secret', token), null);
    assert.equal(readUnsubscribeToken(SECRET, payload), null);
  });

  it('the email escapes the recruiter’s text and always carries the unsubscribe link', () => {
    const e = render('outreach', {
      subject: 'Role at Acme', body: 'Hi <b>Priya</b>,\n\nInterested?', companyName: 'Acme', unsubscribePath: '/api/v1/outreach/unsubscribe?token=abc',
    }, 'https://asteai.com');
    assert.match(e.html, /Hi &lt;b&gt;Priya&lt;\/b&gt;/);
    assert.match(e.html, /https:\/\/asteai\.com\/api\/v1\/outreach\/unsubscribe\?token=abc/);
    assert.match(e.text, /Unsubscribe from Acme: https:\/\/asteai\.com/);
  });

  it('delivery status combines the message and its outbox row', () => {
    assert.deepEqual(
      [['queued', null], ['released', 'pending'], ['released', 'sent'], ['released', 'failed'], ['skipped', null], ['cancelled', null]]
        .map(([m, o]) => deliveryOf(m as string, o)),
      ['queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'],
    );
  });
});

describe('OutreachService.queue (rate limit and suppression)', () => {
  const recipients = [
    { email: 'a@x.test', fullName: 'Asha Rao' }, { email: 'b@x.test', fullName: 'Bala' }, { email: 'c@x.test', fullName: 'Chen Li' },
  ];
  function setup(usedToday: number, dailyLimit = 2000, suppressed: string[] = []) {
    const db = fakeDb([
      [/FROM ats_outreach_campaigns WHERE id = \$1 AND tenant_id = \$2 FOR UPDATE/, [{
        id: CAMPAIGN, tenant_id: 'T1', created_by: 'e1', name: 'SRE push', subject_template: '{{jobTitle}} at {{companyName}}',
        body_template: 'Hi {{firstName}},\n\n{{senderName}}', requisition_id: 'REQ-1', pool_id: null, status: 'draft',
        rate_per_minute: 2, recipients, queued_at: null, completed_at: null, created_at: new Date(),
      }]],
      [/SELECT COUNT\(\*\)::int AS n FROM outreach_messages/, [{ n: usedToday }]],
      [/FROM tenants t\s+LEFT JOIN requisitions/, [{ company: 'Acme', job_title: 'SRE', sender: 'Esha K' }]],
      [/FROM outreach_suppressions WHERE tenant_id/, suppressed.map((email) => ({ email }))],
      [/UPDATE ats_outreach_campaigns SET status = 'queued'/, [{ id: CAMPAIGN, status: 'queued', recipients, rate_per_minute: 2, created_at: new Date() }]],
      [/COUNT\(\*\)::int AS total/, [{ total: 3, queued: 2, sending: 0, sent: 0, failed: 0, skipped: 1, cancelled: 0 }]],
    ]);
    return { db, svc: new OutreachService(db.pool, {} as TalentPoolsService, { dailyLimit, unsubscribeSecret: SECRET }) };
  }

  it('renders one message per recipient, spaced at the campaign rate; unsubscribed addresses are skipped', async () => {
    const { svc, db } = setup(0, 2000, ['b@x.test']);
    const out = await svc.queue(employer, CAMPAIGN);
    assert.equal(out.status, 'queued');
    const msgs = JSON.parse(String(db.all(/INSERT INTO outreach_messages/)[0].params[2])) as { to_email: string; subject: string; body: string; status: string; send_after: string }[];
    assert.deepEqual(msgs.map((m) => [m.to_email, m.status]), [['a@x.test', 'queued'], ['b@x.test', 'skipped'], ['c@x.test', 'queued']]);
    assert.equal(msgs[0].subject, 'SRE at Acme');
    assert.equal(msgs[2].body, 'Hi Chen,\n\nEsha K');
    // 2 a minute: the two sendable messages are 30 s apart (the skipped one takes no slot).
    assert.equal(Date.parse(msgs[2].send_after) - Date.parse(msgs[0].send_after), 30_000);
    assert.equal(db.all(/pg_advisory_xact_lock/).length, 1, 'queueing is serialized per company');
  });

  it('429 when the campaign would exceed the company’s daily limit, and nothing is queued', async () => {
    const { svc, db } = setup(1998, 2000);
    await assert.rejects(svc.queue(employer, CAMPAIGN), (err: unknown) => err instanceof HttpException && err.getStatus() === 429);
    assert.equal(db.all(/INSERT INTO outreach_messages/).length, 0);
    assert.deepEqual(db.tx(), ['BEGIN', 'ROLLBACK']);
  });

  it('create refuses unknown template variables and needs a pool or a list', async () => {
    const svc = new OutreachService(fakeDb([]).pool, {} as TalentPoolsService, { dailyLimit: 10, unsubscribeSecret: SECRET });
    await assert.rejects(svc.create(employer, { name: 'x', subjectTemplate: 'Hi {{firstname}}', bodyTemplate: 'Hello there', recipients }), /firstname/);
    await assert.rejects(svc.create(employer, { name: 'x', subjectTemplate: 'Hi', bodyTemplate: 'Hello there' }), BadRequestException);
  });
});

describe('OutreachDispatcher', () => {
  it('releases due messages into email_outbox in the same transaction, skipping new unsubscribes', async () => {
    const db = fakeDb([
      [/FROM outreach_messages m\s+JOIN ats_outreach_campaigns c/, [
        { id: 'm1', tenant_id: 'T1', to_email: 'a@x.test', subject: 'SRE at Acme', body: 'Hi', company: 'Acme', suppressed: false },
        { id: 'm2', tenant_id: 'T1', to_email: 'b@x.test', subject: 'SRE at Acme', body: 'Hi', company: 'Acme', suppressed: true },
      ]],
    ]);
    const email = fakeEmail();
    const dispatcher = new OutreachDispatcher(db.pool, email.svc, { dailyLimit: 10, unsubscribeSecret: SECRET }, fakeConfig({ OUTREACH_DISPATCH_ENABLED: 'false' }));
    assert.deepEqual(await dispatcher.dispatch(), { released: 1, skipped: 1 });
    assert.equal(email.queued.length, 1);
    assert.equal(email.queued[0].template, 'outreach');
    assert.equal(email.queued[0].inTx, true);
    const token = decodeURIComponent(String(email.queued[0].data.unsubscribePath).split('token=')[1]);
    assert.deepEqual(readUnsubscribeToken(SECRET, token), { tenantId: 'T1', email: 'a@x.test' });
    assert.deepEqual(db.all(/SET status = 'released'/)[0].params, ['m1', 'mail-id']);
    assert.equal(db.all(/SET status = 'skipped'/)[0].params[0], 'm2');
    assert.ok(db.all(/SET status = 'completed'/).length === 1, 'finished campaigns are closed');
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('unsubscribe suppresses the address and cancels what is still queued for it', async () => {
    const db = fakeDb([]);
    const svc = new OutreachService(db.pool, {} as TalentPoolsService, { dailyLimit: 10, unsubscribeSecret: SECRET });
    assert.equal(await svc.unsubscribe(unsubscribeToken(SECRET, 'T1', 'a@x.test')), true);
    assert.deepEqual(db.all(/INSERT INTO outreach_suppressions/)[0].params, ['T1', 'a@x.test']);
    assert.equal(db.all(/SET status = 'skipped', skip_reason = 'unsubscribed'/).length, 1);
    assert.equal(await svc.unsubscribe('garbage'), false);
  });
});

