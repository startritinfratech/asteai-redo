import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import type { Requisition, User } from '@asteai/types';
import { fakeDb, fakeEmail, type Route } from '../../test-support/fakes';
import { PUBLIC_JOB_WHERE } from '../public/job-board';
import { approvalAfterEdit, canSubmitForApproval, changedPublicFields, rubricWeightsValid } from './approval';
import { RequisitionsService } from './requisitions.service';

const owner = { id: 'own-1', role: 'Employer', tenantId: 'T1', firstName: 'O', lastName: 'W' } as User;
const otherEmployer = { ...owner, id: 'own-2' } as User;
const admin = { id: 'adm-1', role: 'Admin', tenantId: null } as unknown as User;

const row = (over: Record<string, unknown> = {}) => ({
  id: 'REQ-1', tenant_id: 'T1', owner_id: 'own-1', owner_name: 'O W', title: 'SRE', industry: 'Tech', func: 'Eng',
  ech_level: 3, tier: 'Technical', weight_iq: 40, weight_eq: 30, weight_grit: 30, language: 'en', location: 'Pune',
  headcount: 1, min_shortlist: 5, threshold: 6, status: 'Open', sla_funded: false, stack: ['Go'], brief: 'Run prod',
  is_public: false, employment_type: 'full_time', location_type: 'onsite', salary_min: null, salary_max: null,
  salary_currency: 'INR', requirements: [], expires_at: null, published_at: null,
  approval_status: 'draft', approval_note: null, approval_submitted_at: null, approval_reviewed_at: null,
  screening_questions: [], evaluation_rubric: [], created_at: new Date(), updated_at: new Date(), ...over,
});

describe('approval rules', () => {
  const approved = { title: 'SRE', brief: 'Run prod', stack: ['Go'], posting: { salaryMax: 100, requirements: [] } } as unknown as Requisition;

  it('only real changes to job-seeker-visible fields count', () => {
    assert.deepEqual(changedPublicFields(approved, { title: 'SRE' }), []);
    assert.deepEqual(changedPublicFields(approved, { title: 'Senior SRE', salaryMax: 100 }), ['title']);
    assert.deepEqual(changedPublicFields(approved, { stack: ['Go', 'Rust'], salaryMax: 120 }), ['stack', 'salaryMax']);
  });

  it('editing an approved job sends it back to review; publishing a draft submits it', () => {
    assert.equal(approvalAfterEdit('approved', 1, false), 'pending');
    assert.equal(approvalAfterEdit('approved', 0, true), 'approved');
    assert.equal(approvalAfterEdit('draft', 0, true), 'pending');
    assert.equal(approvalAfterEdit('rejected', 2, false), 'rejected');
    assert.equal(approvalAfterEdit('draft', 0, false), 'draft');
    assert.deepEqual(['draft', 'pending', 'approved', 'rejected'].map((s) => canSubmitForApproval(s as never)), [true, false, false, true]);
  });

  it('rubric weights: whole numbers summing to exactly 100', () => {
    assert.ok(rubricWeightsValid([]));
    assert.ok(rubricWeightsValid([{ weight: 60 }, { weight: 40 }]));
    assert.equal(rubricWeightsValid([{ weight: 60 }, { weight: 30 }]), false);
    assert.equal(rubricWeightsValid([{ weight: 50.5 }, { weight: 49.5 }]), false);
  });

  it('the public job board lists only approved requisitions', () => {
    assert.match(PUBLIC_JOB_WHERE, /r\.approval_status = 'approved'/);
  });
});

function setup(existing = row(), extra: Route[] = []) {
  const email = fakeEmail();
  const db = fakeDb([
    ...extra,
    [/WHERE r\.id = \$1/, [existing]],
    [/SET approval_status = 'pending', approval_submitted_at = NOW\(\)/, () => (['draft', 'rejected'].includes(existing.approval_status as string) ? [{ ...existing, approval_status: 'pending' }] : [])],
    [/WHERE id = \$1 AND approval_status = 'pending'\s+RETURNING/, (p) => (existing.approval_status === 'pending' ? [{ ...existing, approval_status: p[1], approval_note: p[2] }] : [])],
    [/SELECT email, first_name FROM user_accounts/, [{ email: 'owner@co.test', first_name: 'Olu' }]],
    [/UPDATE requisitions SET\s+is_public/, (p) => [{ ...existing, is_public: p[1] ?? existing.is_public, approval_status: p[12] }]],
    [/UPDATE requisitions SET\s+title/, (p) => [{ ...existing, title: p[0] ?? existing.title, approval_status: p[20] }]],
  ]);
  return { db, email, svc: new RequisitionsService(db.pool, email.svc) };
}

describe('RequisitionsService approval gating', () => {
  it('making a draft public submits it for review instead of listing it', async () => {
    const { svc, db } = setup();
    const out = await svc.updatePosting('REQ-1', { isPublic: true }, owner);
    assert.equal(out.approval?.status, 'pending');
    assert.equal(db.all(/UPDATE requisitions SET\s+is_public/)[0].params[12], 'pending');
  });

  it('changing the title of an approved job sends it back to pending; other edits keep it approved', async () => {
    const a = setup(row({ approval_status: 'approved', is_public: true }));
    assert.equal((await a.svc.update('REQ-1', { title: 'Senior SRE' }, owner)).approval?.status, 'pending');
    const b = setup(row({ approval_status: 'approved', is_public: true }));
    assert.equal((await b.svc.update('REQ-1', { headcount: 3 }, owner)).approval?.status, 'approved');
  });

  it('owners submit drafts or rejected jobs; pending or approved ones are 409; other employers 403', async () => {
    assert.equal((await setup().svc.submitForApproval('REQ-1', owner)).approval?.status, 'pending');
    await assert.rejects(setup(row({ approval_status: 'pending' })).svc.submitForApproval('REQ-1', owner), ConflictException);
    await assert.rejects(setup(row({ approval_status: 'approved' })).svc.submitForApproval('REQ-1', owner), ConflictException);
    await assert.rejects(setup().svc.submitForApproval('REQ-1', otherEmployer), ForbiddenException);
  });

  it('only an admin can approve, only a pending job, and the owner is emailed in the same transaction', async () => {
    await assert.rejects(setup(row({ approval_status: 'pending' })).svc.review('REQ-1', owner, 'approved'), ForbiddenException);
    await assert.rejects(setup(row({ approval_status: 'draft' })).svc.review('REQ-1', admin, 'approved'), ConflictException);

    const { svc, email, db } = setup(row({ approval_status: 'pending' }));
    const out = await svc.review('REQ-1', admin, 'approved');
    assert.equal(out.approval?.status, 'approved');
    assert.deepEqual(email.queued.map((q) => [q.template, q.to, q.data.decision, q.inTx]), [['job-approval-decision', 'owner@co.test', 'approved', true]]);
    assert.deepEqual(db.tx(), ['BEGIN', 'COMMIT']);
  });

  it('rejecting needs a note for the owner', async () => {
    await assert.rejects(setup(row({ approval_status: 'pending' })).svc.review('REQ-1', admin, 'rejected', '  '), BadRequestException);
    const { svc, email } = setup(row({ approval_status: 'pending' }));
    assert.equal((await svc.review('REQ-1', admin, 'rejected', 'Remove the age requirement')).approval?.note, 'Remove the age requirement');
    assert.equal(email.queued[0].data.note, 'Remove the age requirement');
  });

  it('a requisition with applications can’t be deleted', async () => {
    const { svc } = setup(row(), [[/DELETE FROM requisitions/, []]]);
    await assert.rejects(svc.remove('REQ-1', owner), ConflictException);
  });
});
