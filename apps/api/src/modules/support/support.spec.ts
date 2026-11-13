import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { User } from '@asteai/types';
import { fakeDb, fakeEmail, type Route } from '../../test-support/fakes';
import { statusAfterMessage, SupportService } from './support.service';

const user = { id: 'u-1', role: 'Candidate' } as User;
const staff = { id: 'admin-1', role: 'Admin' } as User;
const ticketRow = (over: Record<string, unknown> = {}) => ({
  id: 'TKT-1', user_id: 'u-1', category_id: 'account', subject: 'Cannot sign in', status: 'open', assignee_id: null,
  created_at: new Date(), updated_at: new Date(), ...over,
});

function setup(routes: Route[]) {
  const db = fakeDb(routes);
  const email = fakeEmail();
  return { db, email, svc: new SupportService(db.pool, email.svc) };
}

describe('support status rules', () => {
  it('a staff reply waits on the user; a user reply reopens', () => {
    assert.equal(statusAfterMessage(true), 'pending_user');
    assert.equal(statusAfterMessage(false), 'open');
  });
});

describe('SupportService', () => {
  it('rejects unknown categories', async () => {
    const { svc } = setup([]);
    await assert.rejects(svc.create({ categoryId: 'nope', subject: 'Help', body: 'Something broke here' }, user), BadRequestException);
  });

  it('creates the ticket with its first message in one transaction', async () => {
    const { svc, db } = setup([
      [/FROM support_categories WHERE id/, [{}]],
      [/INSERT INTO support_tickets/, [ticketRow()]],
      [/FROM support_messages m/, [{ id: 'm1', from_staff: false, body: 'Something broke here', created_at: new Date(), first_name: 'Jane', last_name: 'Doe' }]],
    ]);
    const t = await svc.create({ categoryId: 'account', subject: 'Cannot sign in', body: 'Something broke here' }, user);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
    assert.match(db.all(/INSERT INTO support_tickets/)[0].params[0] as string, /^TKT-/);
    assert.equal(t.messages[0].authorName, 'Jane Doe');
  });

  it("hides other users' tickets as 404", async () => {
    const { svc, db } = setup([]);
    await assert.rejects(svc.get('TKT-1', user), NotFoundException);
    assert.deepEqual(db.log[0].params, ['TKT-1', 'u-1']);
  });

  it('staff replies are anonymised, move the ticket to pending_user and email the user', async () => {
    const { svc, db, email } = setup([
      [/FOR UPDATE OF t/, [ticketRow({ email: 'jane@x.com', first_name: 'Jane' })]],
      [/UPDATE support_tickets SET status = \$2/, (p) => [ticketRow({ status: p[1] })]],
      [/FROM support_messages m/, [{ id: 'm2', from_staff: true, body: 'Try again', created_at: new Date(), first_name: 'Sam', last_name: 'Staff' }]],
    ]);
    const t = await svc.staffReply('TKT-1', 'Try again', staff);
    assert.equal(t.status, 'pending_user');
    assert.equal(t.messages[0].authorName, 'ASTEAI Support');
    assert.deepEqual(email.queued.map((q) => [q.template, q.to, q.inTx]), [['support-reply', 'jane@x.com', true]]);
    assert.equal(db.all(/INSERT INTO support_messages/)[0].params[2], true);
  });
});
