import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { allowedNextStages, APPLICATION_STAGE_MOVES, canMoveApplication, type ApplicationStage, type User } from '@asteai/types';
import { fakeDb } from '../../test-support/fakes';
import { ApplicationsService } from './applications.service';

const employer = { id: 'e1', role: 'Employer', tenantId: 'T1', firstName: 'Esha', lastName: 'K' } as User;
const otherCo = { ...employer, id: 'e2', tenantId: 'T2' } as User;
const admin = { id: 'a1', role: 'Admin', tenantId: null } as unknown as User;

describe('pipeline transition rules', () => {
  it('walks applied → screened → interview → shortlist → offer → joined, one step at a time', () => {
    const path: ApplicationStage[] = ['Applied', 'Screened', 'Interview', 'Shortlisted', 'Offer', 'Joined'];
    for (let i = 0; i < path.length - 1; i++) {
      assert.equal(canMoveApplication(path[i], path[i + 1]), true, `${path[i]} → ${path[i + 1]}`);
      for (let j = i + 2; j < path.length; j++) assert.equal(canMoveApplication(path[i], path[j]), false, `no skipping ${path[i]} → ${path[j]}`);
    }
  });

  it('never goes backwards (except another interview round after the shortlist)', () => {
    assert.equal(canMoveApplication('Interview', 'Screened'), false);
    assert.equal(canMoveApplication('Offer', 'Shortlisted'), false);
    assert.equal(canMoveApplication('Shortlisted', 'Interview'), true);
  });

  it('every active stage can reject; Joined and Rejected are final for employers but not admins', () => {
    for (const s of Object.keys(APPLICATION_STAGE_MOVES) as ApplicationStage[]) {
      if (s !== 'Joined' && s !== 'Rejected') assert.ok(canMoveApplication(s, 'Rejected'), s);
    }
    assert.deepEqual(allowedNextStages('Rejected'), []);
    assert.deepEqual(allowedNextStages('Joined'), []);
    assert.equal(canMoveApplication('Rejected', 'Interview', true), true);
    assert.equal(canMoveApplication('Applied', 'Applied', true), false);
  });

  it('the assessment detour rejoins the path at Screened', () => {
    assert.ok(canMoveApplication('Applied', 'Assessment Pending'));
    assert.ok(canMoveApplication('Assessment Pending', 'Assessment Review'));
    assert.ok(canMoveApplication('Assessment Review', 'Screened'));
    assert.equal(canMoveApplication('Assessment Review', 'Offer'), false);
  });
});

function setup(stage: ApplicationStage, tenant = 'T1') {
  const db = fakeDb([
    [/SELECT \* FROM applications WHERE id = \$1 FOR UPDATE/, [{
      id: 'A-1', candidate_id: 'c1', requisition_id: 'REQ-1', tenant_id: tenant, stage, history: [{ t: 1, stage, by: 'system' }],
      created_at: new Date(), updated_at: new Date(),
    }]],
    [/UPDATE applications SET stage/, (p) => [{
      id: 'A-1', candidate_id: 'c1', requisition_id: 'REQ-1', tenant_id: tenant, stage: p[0], history: JSON.parse(String(p[1])),
      created_at: new Date(), updated_at: new Date(),
    }]],
  ]);
  return { db, svc: new ApplicationsService(db.pool) };
}

describe('ApplicationsService.advanceStage (PATCH /applications/:id/stage)', () => {
  it('moves one step, appends history, inside a transaction with the row locked', async () => {
    const { svc, db } = setup('Applied');
    const out = await svc.advanceStage('A-1', 'Screened', 'Esha K', employer);
    assert.equal(out.stage, 'Screened');
    const [update] = db.all(/UPDATE applications SET stage/);
    const history = JSON.parse(String(update.params[1]));
    assert.deepEqual(history.map((h: { stage: string }) => h.stage), ['Applied', 'Screened']);
    assert.equal(history[1].by, 'Esha K');
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('refuses to skip a stage (409) and names the allowed next stages', async () => {
    const { svc, db } = setup('Applied');
    await assert.rejects(svc.advanceStage('A-1', 'Interview', 'Esha', employer), (err: unknown) =>
      err instanceof ConflictException && /Next: Screened, Eligibility, Assessment Pending, Rejected/.test(err.message));
    assert.equal(db.all(/UPDATE applications SET stage/).length, 0);
    assert.deepEqual(db.tx(), ['BEGIN', 'ROLLBACK']);
  });

  it('a rejection needs a reason, which is kept in the history', async () => {
    await assert.rejects(setup('Interview').svc.advanceStage('A-1', 'Rejected', 'Esha', employer), BadRequestException);
    const { svc, db } = setup('Interview');
    await svc.advanceStage('A-1', 'Rejected', 'Esha', employer, { reason: 'Role filled internally' });
    assert.equal(JSON.parse(String(db.all(/UPDATE applications SET stage/)[0].params[1]))[1].reason, 'Role filled internally');
  });

  it('409 when someone else moved it since the caller looked (expectedStage)', async () => {
    await assert.rejects(setup('Interview').svc.advanceStage('A-1', 'Shortlisted', 'Esha', employer, { expectedStage: 'Screened' }), ConflictException);
  });

  it('the same stage again is a no-op, final stages are final, and admins may correct anything', async () => {
    const same = setup('Offer');
    assert.equal((await same.svc.advanceStage('A-1', 'Offer', 'Esha', employer)).stage, 'Offer');
    assert.equal(same.db.all(/UPDATE applications SET stage/).length, 0);
    await assert.rejects(setup('Joined').svc.advanceStage('A-1', 'Offer', 'Esha', employer), ConflictException);
    assert.equal((await setup('Rejected', 'T9').svc.advanceStage('A-1', 'Interview', 'Admin', admin)).stage, 'Interview');
  });

  it("another company's application is forbidden", async () => {
    await assert.rejects(setup('Applied').svc.advanceStage('A-1', 'Screened', 'X', otherCo), ForbiddenException);
  });
});

describe('ApplicationsService.apply (approval gate)', () => {
  const req = (approval: string, status = 'Open') =>
    fakeDb([[/SELECT tenant_id, status, approval_status FROM requisitions/, [{ tenant_id: 'T1', status, approval_status: approval }]],
      [/INSERT INTO applications/, [{ id: 'A-9', stage: 'Applied', history: [], tenant_id: 'T1', candidate_id: 'c1', requisition_id: 'REQ-1', created_at: new Date(), updated_at: new Date() }]]]);

  it('only an approved, open requisition takes applications', async () => {
    for (const approval of ['draft', 'pending', 'rejected']) {
      const db = req(approval);
      await assert.rejects(new ApplicationsService(db.pool).apply('REQ-1', 'c1'), NotFoundException, approval);
      assert.equal(db.all(/INSERT INTO applications/).length, 0);
    }
    await assert.rejects(new ApplicationsService(req('approved', 'Paused').pool).apply('REQ-1', 'c1'), NotFoundException);
    assert.equal((await new ApplicationsService(req('approved').pool).apply('REQ-1', 'c1')).stage, 'Applied');
  });
});
