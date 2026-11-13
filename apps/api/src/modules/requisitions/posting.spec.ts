import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import type { User } from '@asteai/types';
import { fakeDb } from '../../test-support/fakes';
import { RequisitionsService } from './requisitions.service';

const owner = { id: 'u-owner', role: 'Employer', tenantId: 'T1' } as User;
const other = { id: 'u-other', role: 'Employer', tenantId: 'T1' } as User;

const reqRow = (over: Record<string, unknown> = {}) => ({
  id: 'REQ-1', tenant_id: 'T1', owner_id: 'u-owner', owner_name: 'Olu Owner', title: 'Engineer', industry: 'Tech',
  func: 'Engineering', ech_level: 3, tier: 'Technical', weight_iq: 33, weight_eq: 33, weight_grit: 34, language: 'English',
  location: null, headcount: 1, min_shortlist: 5, threshold: '6.00', status: 'Open', sla_funded: false, stack: [],
  brief: null, created_at: new Date(), updated_at: new Date(), is_public: false, employment_type: 'full_time',
  location_type: 'onsite', salary_min: null, salary_max: '2000000', salary_currency: 'INR', requirements: [],
  expires_at: null, published_at: null, ...over,
});

function setup(existing = reqRow()) {
  const db = fakeDb([
    [/WHERE r\.id = \$1/, [existing]],
    [/UPDATE requisitions SET\s+is_public/, (p) => [{ ...existing, is_public: p[1] ?? existing.is_public, published_at: new Date('2026-11-12T00:00:00Z') }]],
  ]);
  return { db, svc: new RequisitionsService(db.pool) };
}

describe('RequisitionsService.updatePosting', () => {
  it('only the owner (or an admin) can change the posting', async () => {
    const { svc } = setup();
    await assert.rejects(svc.updatePosting('REQ-1', { isPublic: true }, other), ForbiddenException);
  });

  it('checks the salary range against the stored value when only one end changes', async () => {
    const { svc } = setup();
    await assert.rejects(svc.updatePosting('REQ-1', { salaryMin: 3_000_000 }, owner), BadRequestException);
  });

  it('refuses an expiry in the past', async () => {
    const { svc } = setup();
    await assert.rejects(svc.updatePosting('REQ-1', { expiresAt: '2000-01-01T00:00:00Z' }, owner), BadRequestException);
  });

  it('publishes, distinguishing "clear" (null) from "leave alone" (omitted)', async () => {
    const { svc, db } = setup();
    const out = await svc.updatePosting('REQ-1', { isPublic: true, salaryMin: null }, owner);
    const params = db.all(/UPDATE requisitions SET\s+is_public/)[0].params;
    assert.equal(params[1], true);
    assert.deepEqual([params[4], params[5]], [true, null]);   // salaryMin: set to null
    assert.deepEqual([params[6], params[7]], [false, null]);  // salaryMax: untouched
    assert.equal(params[10], false);                          // expiresAt: untouched
    assert.equal(out.posting?.isPublic, true);
    assert.equal(out.posting?.salaryMax, 2000000);
    assert.equal(out.ownerName, 'Olu Owner');
  });
});
