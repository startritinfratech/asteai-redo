import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import { escapeHtml, render, siteUrl } from './templates';
import { EmailWorker, MAX_ATTEMPTS, backoffMinutes } from './email.worker';
import { EmailSendError, type EmailTransport, type OutgoingEmail } from './transports';

describe('templates', () => {
  it('escapes data in HTML but keeps it readable in text', () => {
    const out = render('assessment-reset', {
      firstName: '<b>Asha</b>', requisitionTitle: 'R&D "Lead"', path: '/platform/assess?req=REQ-1',
    }, 'https://app.asteai.test/');
    assert.ok(out.html.includes('&lt;b&gt;Asha&lt;/b&gt;') && !out.html.includes('<b>Asha</b>'));
    assert.ok(out.html.includes('R&amp;D &quot;Lead&quot;'));
    assert.match(out.text, /^Hi <b>Asha<\/b>,/);
    assert.equal(out.subject, 'Your assessment for R&D "Lead" has been reset');
    assert.ok(out.html.includes('https://app.asteai.test/platform/assess?req=REQ-1'));
  });

  it('only links to same-site paths', () => {
    assert.equal(siteUrl('https://a.test/', '/x?y=1'), 'https://a.test/x?y=1');
    assert.equal(siteUrl('https://a.test', '//evil.test'), 'https://a.test/');
    assert.equal(siteUrl('https://a.test', 'https://evil.test'), 'https://a.test/');
  });

  it('renders the expert profile decision with the escaped reviewer note', () => {
    const out = render('expert-profile-decision', {
      firstName: '<i>Asha</i>', decision: 'rework', note: 'Add a <script>alert(1)</script> & portfolio', path: '/platform/profile',
    }, 'https://app.asteai.test');
    assert.equal(out.subject, 'Changes requested on your expert profile');
    assert.ok(!out.html.includes('<script>') && out.html.includes('&lt;script&gt;alert(1)&lt;/script&gt; &amp; portfolio'));
    assert.ok(out.html.includes('&lt;i&gt;Asha&lt;/i&gt;'));
    assert.ok(out.html.includes('https://app.asteai.test/platform/profile'));
    assert.match(out.text, /Note from the reviewer: Add a <script>alert\(1\)<\/script> & portfolio/);

    const approved = render('expert-profile-decision', {
      firstName: 'Asha', decision: 'approved', note: null, path: '/platform/profile',
    }, 'https://app.asteai.test');
    assert.equal(approved.subject, 'Your expert profile is approved');
    assert.doesNotMatch(approved.text, /Note from the reviewer/);
    assert.equal(render('expert-profile-decision', {
      firstName: 'Asha', decision: 'rejected', note: 'Not a fit', path: '/platform/profile',
    }, 'https://a.test').subject, 'Your expert profile was not approved');
  });

  it('escapes every HTML-significant character', () => {
    assert.equal(escapeHtml(`<a href="x">'&'</a>`), '&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });
});

describe('EmailWorker', () => {
  const row = (attempts: number) => ({ id: 'E1', to_address: 'a@b.test', subject: 'S', html: '<p>H</p>', text: 'H', attempts });

  /** Pool fake: the claim query returns `claimed`; every query is recorded. */
  function setup(claimed: ReturnType<typeof row>[], send: (e: OutgoingEmail) => Promise<{ id: string | null }>) {
    const calls: { sql: string; params: unknown[] }[] = [];
    const pool = {
      query: async (sql: string, params: unknown[] = []) => {
        calls.push({ sql, params });
        return { rows: /SET status = 'sending'/.test(sql) ? claimed : [], rowCount: 0 };
      },
    } as unknown as Pool;
    const transport: EmailTransport = { name: 'fake', send };
    const config = { get: () => undefined } as unknown as ConfigService;
    return { worker: new EmailWorker(pool, transport, config), calls };
  }

  it('reclaims stuck rows, then claims with SKIP LOCKED', async () => {
    const { worker, calls } = setup([], async () => ({ id: null }));
    await worker.processBatch();
    assert.match(calls[0].sql, /status = 'sending' AND claimed_at < NOW\(\)/);
    assert.match(calls[1].sql, /FOR UPDATE SKIP LOCKED/);
  });

  it('marks a delivered email sent with the provider id', async () => {
    let got: OutgoingEmail | null = null;
    const { worker, calls } = setup([row(1)], async (e) => { got = e; return { id: 'ses-123' }; });
    assert.equal(await worker.processBatch(), 1);
    assert.deepEqual(got, { to: 'a@b.test', subject: 'S', html: '<p>H</p>', text: 'H' });
    assert.match(calls[2].sql, /SET status = 'sent'/);
    assert.deepEqual(calls[2].params, ['E1', 'ses-123']);
  });

  it('blanks the body of a sent email but keeps subject, template and recipient', async () => {
    const { worker, calls } = setup([row(1)], async () => ({ id: 'ses-1' }));
    await worker.processBatch();
    const sent = calls[2].sql;
    assert.match(sent, /SET status = 'sent'/);
    assert.match(sent, /html = ''/);
    assert.match(sent, /text = ''/);
    assert.doesNotMatch(sent, /subject|template|to_address/);
  });

  it('keeps the body of a failed email for the retry', async () => {
    for (const err of [new EmailSendError('Throttling', false), new EmailSendError('MessageRejected', true)]) {
      const { worker, calls } = setup([row(1)], async () => { throw err; });
      await worker.processBatch();
      assert.doesNotMatch(calls[2].sql, /html|text =/, err.message);
    }
  });

  it('retries a temporary failure later with backoff', async () => {
    const { worker, calls } = setup([row(2)], async () => { throw new EmailSendError('Throttling', false); });
    assert.equal(await worker.processBatch(), 0);
    assert.match(calls[2].sql, /SET status = 'pending'.*next_attempt_at = NOW\(\) \+ make_interval/s);
    assert.deepEqual(calls[2].params, ['E1', 'Throttling', backoffMinutes(2)]);
  });

  it('fails at once on a permanent error', async () => {
    const { worker, calls } = setup([row(1)], async () => { throw new EmailSendError('MessageRejected: bad address', true); });
    await worker.processBatch();
    assert.match(calls[2].sql, /SET status = 'failed'/);
  });

  it('gives up after the last attempt', async () => {
    const { worker, calls } = setup([row(MAX_ATTEMPTS)], async () => { throw new Error('socket hang up'); });
    await worker.processBatch();
    assert.match(calls[2].sql, /SET status = 'failed'/);
    assert.deepEqual(calls[2].params, ['E1', 'socket hang up']);
  });

  it('backs off 1, 2, 4, 8, 16 minutes, capped at an hour', () => {
    assert.deepEqual([1, 2, 3, 4, 5, 10].map(backoffMinutes), [1, 2, 4, 8, 16, 60]);
  });
});
