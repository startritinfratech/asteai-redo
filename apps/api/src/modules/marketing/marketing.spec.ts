import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { fakeBots, fakeConfig, fakeDb, fakeEmail } from '../../test-support/fakes';
import { render } from '../email/templates';
import { sha256Hex } from '../auth/totp';
import { ContactDto, LeadDto } from './dto/marketing.dto';
import { DEFAULT_INBOX, MarketingService } from './marketing.service';

const ctx = { ip: '203.0.113.9', userAgent: 'test-agent' };

const lead = (over: Partial<LeadDto> = {}) => ({
  track: 'technical', roleTitle: 'ML Engineer', skills: 'PyTorch', workMode: 'remote', timeline: 'immediate',
  company: 'Acme', contactName: 'Jane Smith', email: 'jane@acme.com', phone: '+919876543210', ...over,
}) as LeadDto;

function service(routes: Parameters<typeof fakeDb>[0] = [], verdict: Parameters<typeof fakeBots>[0] = 'ok', env = {}) {
  const db = fakeDb(routes);
  const email = fakeEmail();
  const bots = fakeBots(verdict);
  const svc = new MarketingService(db.pool, email.svc, bots.svc, fakeConfig(env));
  return { svc, db, email, bots };
}

const errorsFor = <T extends object>(cls: new () => T, body: object) =>
  validateSync(plainToInstance(cls, body) as object).map((e) => e.property);

describe('marketing DTOs', () => {
  it('accepts a well-formed lead and normalises phone formatting', () => {
    const dto = plainToInstance(LeadDto, { ...lead(), phone: '+91 98765-43210', email: ' Jane@Acme.com ' });
    assert.deepEqual(validateSync(dto), []);
    assert.equal(dto.phone, '+919876543210');
    assert.equal(dto.email, 'jane@acme.com');
  });

  it('rejects unknown tracks, short titles and non-E.164 phones', () => {
    assert.deepEqual(errorsFor(LeadDto, lead({ track: 'other' as never, roleTitle: 'x', phone: '98765' })).sort(), ['phone', 'roleTitle', 'track']);
  });

  it('enforces the contact form lengths the web form shows', () => {
    const bad = { name: 'J', email: 'nope', subject: 'Hi', message: 'short' };
    assert.deepEqual(errorsFor(ContactDto, bad).sort(), ['email', 'message', 'name', 'subject']);
    assert.deepEqual(errorsFor(ContactDto, { name: 'Jane', email: 'j@x.com', subject: 'Pricing', message: 'Tell me more please' }), []);
  });
});

describe('MarketingService.submitLead', () => {
  it('stores the lead and queues both emails inside one transaction', async () => {
    const { svc, db, email, bots } = service([[/INSERT INTO leads/, [{ id: 'lead-1' }]]]);
    assert.deepEqual(await svc.submitLead(lead(), ctx), { received: true });
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
    const insert = db.all(/INSERT INTO leads/)[0];
    assert.equal(insert.params[10], '203.0.113.9');
    assert.deepEqual(email.queued.map((q) => [q.template, q.to, q.inTx]), [
      ['lead-received', DEFAULT_INBOX, true],
      ['lead-ack', 'jane@acme.com', true],
    ]);
    assert.equal(bots.calls[0].ip, '203.0.113.9');
  });

  it('sends the internal notice to SALES_INBOX when configured', async () => {
    const { svc, email } = service([[/INSERT INTO leads/, [{ id: 'lead-1' }]]], 'ok', { SALES_INBOX: 'sales@asteai.com' });
    await svc.submitLead(lead(), ctx);
    assert.equal(email.queued[0].to, 'sales@asteai.com');
  });

  it('answers success for a honeypot hit but writes and sends nothing', async () => {
    const { svc, db, email } = service([], 'drop');
    assert.deepEqual(await svc.submitLead(lead(), ctx), { received: true });
    assert.equal(db.log.length, 0);
    assert.equal(email.queued.length, 0);
  });

  it('propagates a failed bot check without touching the database', async () => {
    const { svc, db } = service([], new BadRequestException('The security check failed.'));
    await assert.rejects(svc.submitLead(lead(), ctx), BadRequestException);
    assert.equal(db.log.length, 0);
  });
});

describe('MarketingService.submitContact', () => {
  it('defaults intent to contact and acknowledges the sender', async () => {
    const { svc, db, email } = service([[/INSERT INTO contact_messages/, [{ id: 'msg-1' }]]]);
    await svc.submitContact({ name: 'Jane', email: 'j@x.com', subject: 'Pricing', message: 'Tell me more please' } as ContactDto, ctx);
    assert.equal(db.all(/INSERT INTO contact_messages/)[0].params[4], 'contact');
    assert.deepEqual(email.queued.map((q) => q.template), ['contact-received', 'contact-ack']);
  });
});

describe('MarketingService newsletter', () => {
  it('stores only hashes and emails the raw confirm / unsubscribe tokens', async () => {
    const { svc, db, email } = service([[/INSERT INTO newsletter_subscribers/, [{ id: 'sub-1' }]]]);
    assert.deepEqual(await svc.subscribe({ email: 'a@b.com' } as never, ctx), { status: 'pending' });
    const params = db.all(/INSERT INTO newsletter_subscribers/)[0].params;
    const data = email.queued[0].data as { path: string; unsubscribePath: string };
    const confirmRaw = data.path.split('token=')[1];
    const unsubRaw = data.unsubscribePath.split('token=')[1];
    assert.equal(params[2], sha256Hex(confirmRaw));
    assert.equal(params[4], sha256Hex(unsubRaw));
    assert.ok(!JSON.stringify(params).includes(confirmRaw));
  });

  it('answers pending but sends nothing for an already-subscribed address', async () => {
    const { svc, email } = service([[/INSERT INTO newsletter_subscribers/, []]]);
    assert.deepEqual(await svc.subscribe({ email: 'a@b.com' } as never, ctx), { status: 'pending' });
    assert.equal(email.queued.length, 0);
  });

  it('confirms with a valid token and refuses an unknown or expired one', async () => {
    const ok = service([[/UPDATE newsletter_subscribers/, [{}]]]);
    assert.deepEqual(await ok.svc.confirmSubscription('t'.repeat(43)), { status: 'subscribed' });
    assert.equal(ok.db.log[0].params[0], sha256Hex('t'.repeat(43)));
    const bad = service([[/UPDATE newsletter_subscribers/, []]]);
    await assert.rejects(bad.svc.confirmSubscription('t'.repeat(43)), BadRequestException);
  });

  it('unsubscribes by token', async () => {
    const { svc } = service([[/UPDATE newsletter_subscribers/, [{}]]]);
    assert.deepEqual(await svc.unsubscribe('u'.repeat(43)), { status: 'unsubscribed' });
  });
});

describe('MarketingService careers', () => {
  it('404s for a closed or unknown role and rolls back', async () => {
    const { svc, db, email } = service([[/FROM career_roles/, []]]);
    await assert.rejects(svc.applyForRole({ roleSlug: 'nope', fullName: 'Jane', email: 'j@x.com' } as never, ctx), NotFoundException);
    assert.deepEqual(db.tx(), ['BEGIN', 'ROLLBACK']);
    assert.equal(email.queued.length, 0);
  });

  it('stores the application against the role and emails both sides with the role title', async () => {
    const { svc, email } = service([
      [/FROM career_roles/, [{ id: 'role-1', title: 'Product Engineer' }]],
      [/INSERT INTO career_applications/, [{ id: 'app-1' }]],
    ]);
    await svc.applyForRole({ roleSlug: 'product-engineer', fullName: 'Jane Smith', email: 'j@x.com' } as never, ctx);
    assert.deepEqual(email.queued.map((q) => [q.template, q.data.roleTitle]), [
      ['career-application', 'Product Engineer'],
      ['career-ack', 'Product Engineer'],
    ]);
  });
});

describe('public-form email templates', () => {
  it('keep user input out of subject-line newlines and escape it in HTML', () => {
    const mail = render('contact-received', {
      messageId: 'm1', intent: 'contact', name: '<b>Eve</b>', email: 'e@x.com', subject: 'Hi\r\nBcc: x@y.com', message: '<script>x</script>',
    }, 'https://asteai.com');
    assert.ok(!/[\r\n]/.test(mail.subject));
    assert.ok(!mail.html.includes('<script>'));
    assert.ok(mail.html.includes('&lt;script&gt;'));
    assert.match(mail.html, /Internal notification/);
  });

  it('give form recipients a footer that does not claim they have an account', () => {
    const mail = render('lead-ack', { contactName: 'Jane Smith', roleTitle: 'ML Engineer' }, 'https://asteai.com');
    assert.match(mail.text, /^Hi Jane,/);
    assert.ok(!mail.html.includes('you have an AsteAI account'));
  });
});
