import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';

/** A pool that answers queries in order from `replies` and records the SQL it saw. */
function fakePool(replies: { rows: unknown[] }[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const pool = {
    query: async (text: string, values: unknown[] = []) => {
      sql.push(text);
      params.push(values);
      const next = replies.shift() ?? { rows: [] };
      return { rowCount: next.rows.length, ...next };
    },
  } as unknown as Pool;
  return { pool, sql, params };
}

const employer = { id: 'emp-1', role: 'Employer', tenantId: 'T1' } as User;
const admin = { id: 'adm-1', role: 'Admin', tenantId: null } as User;
const member = { email: 'new@example.test', firstName: 'New', lastName: 'Person', role: 'Employer' as const };

describe('TenantsController access', () => {
  const { pool, sql } = fakePool([]);
  const ctrl = new TenantsController(new TenantsService(pool));

  it("refuses an employer on another tenant's routes before touching the database", () => {
    const calls: Array<() => unknown> = [
      () => ctrl.findOne('T2', employer),
      () => ctrl.getTeam('T2', employer),
      () => ctrl.addTeamMember('T2', member, employer),
      () => ctrl.getPools('T2', employer),
      () => ctrl.createPool('T2', { name: 'P' }, employer),
      () => ctrl.getOutreach('T2', employer),
      () => ctrl.createOutreach('T2', { name: 'C', channel: 'Email' }, employer),
    ];
    for (const call of calls) assert.throws(call, ForbiddenException);
    assert.equal(sql.length, 0);
  });

  it('refuses an employer with no tenant', () => {
    assert.throws(() => ctrl.getTeam('T1', { ...employer, tenantId: null }), ForbiddenException);
  });

  it('lets an employer read their own tenant and an admin read any tenant', async () => {
    const { pool: p } = fakePool([{ rows: [] }, { rows: [] }]);
    const c = new TenantsController(new TenantsService(p));
    assert.deepEqual(await c.getTeam('T1', employer), []);
    assert.deepEqual(await c.getTeam('T2', admin), []);
  });
});

describe('TenantsService', () => {
  it('never updates an existing account when adding a team member', async () => {
    const { pool, sql } = fakePool([{ rows: [] }]); // conflict: nothing inserted
    await assert.rejects(new TenantsService(pool).addTeamMember('T1', member), (e: HttpException) => e.getStatus() === 409);
    assert.match(sql[0], /ON CONFLICT \(email\) DO NOTHING/);
    assert.match(sql[0], /WHERE NOT EXISTS/);
    assert.doesNotMatch(sql[0], /DO UPDATE|UPDATE user_accounts/);
  });

  it('returns the new member when the email is free', async () => {
    const { pool, params } = fakePool([{ rows: [{ id: 'u-9', email: member.email }] }]);
    const out = await new TenantsService(pool).addTeamMember('T1', member);
    assert.equal(out.id, 'u-9');
    assert.deepEqual(params[0], [member.email, 'New', 'Person', 'Employer', '', 'T1']);
  });

  it('maps tenants to the camelCase Tenant shape', async () => {
    const { pool } = fakePool([{ rows: [{
      id: 'T1', name: 'Acme', industry: 'Retail', plan: 'Growth', credits: 40, seats: 5,
      domain: null, retention_months: 12, sso_enabled: false,
    }] }]);
    assert.deepEqual(await new TenantsService(pool).findOne('T1'), {
      id: 'T1', name: 'Acme', industry: 'Retail', plan: 'Growth', credits: 40, seats: 5,
      domain: '', retentionMonths: 12, ssoEnabled: false,
    });
  });
});
