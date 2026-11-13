import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ForbiddenException, HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import type { User } from '@asteai/types';
import { EmailService } from '../email/email.service';
import { sha256Hex } from '../auth/totp';
import { TenantsService } from './tenants.service';
import { TenantsController } from './tenants.controller';

/** A pool that answers queries in order from `replies` and records the SQL it saw. */
function fakePool(replies: { rows: unknown[] }[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    const next = replies.shift() ?? { rows: [] };
    return { rowCount: next.rows.length, ...next };
  };
  // withTransaction() takes a client from the pool; the fake hands back itself.
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

const config = { get: () => 'https://app.example.test' } as unknown as ConfigService;
const tenantsService = (pool: Pool) => new TenantsService(pool, new EmailService(pool, config));

const employer = { id: 'emp-1', role: 'Employer', tenantId: 'T1', firstName: 'Ira', lastName: 'Boss' } as User;
const admin = { id: 'adm-1', role: 'Admin', tenantId: null } as User;
const member = { email: 'new@example.test', firstName: 'New', lastName: 'Person', role: 'Employer' as const };

describe('TenantsController access', () => {
  const { pool, sql } = fakePool([]);
  const ctrl = new TenantsController(tenantsService(pool));

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
    const c = new TenantsController(tenantsService(p));
    assert.deepEqual(await c.getTeam('T1', employer), []);
    assert.deepEqual(await c.getTeam('T2', admin), []);
  });
});

describe('TenantsService', () => {
  it('never updates an existing account when adding a team member, and sends no invite', async () => {
    const { pool, sql } = fakePool([{ rows: [] }]); // conflict: nothing inserted
    await assert.rejects(tenantsService(pool).addTeamMember('T1', member, employer), (e: HttpException) => e.getStatus() === 409);
    const insert = sql.find((q) => /INSERT INTO user_accounts/.test(q)) ?? '';
    assert.match(insert, /ON CONFLICT \(email\) DO NOTHING/);
    assert.match(insert, /WHERE NOT EXISTS/);
    assert.ok(!sql.some((q) => /DO UPDATE|UPDATE user_accounts|auth_tokens|email_outbox/.test(q)));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  it('creates an unverified member with a single-use set-password invite, in one transaction', async () => {
    const { pool, sql, params } = fakePool([
      { rows: [{ id: 'u-9', email: member.email, first_name: 'New' }] },
      { rows: [{ name: 'Acme <Retail>' }] },
      { rows: [] }, { rows: [] }, // retire older tokens, insert the new one
      { rows: [{ id: 'mail-1' }] },
    ]);
    const out = await tenantsService(pool).addTeamMember('T1', member, employer);
    assert.equal(out.id, 'u-9');

    const insert = sql.findIndex((q) => /INSERT INTO user_accounts/.test(q));
    assert.match(sql[insert], /'local', 'active', false/);
    assert.deepEqual(params[insert], [member.email, 'New', 'Person', 'Employer', '', 'T1']);

    const token = sql.findIndex((q) => /INSERT INTO auth_tokens/.test(q));
    const mail = sql.findIndex((q) => /INSERT INTO email_outbox/.test(q));
    const begin = sql.indexOf('BEGIN');
    const commit = sql.indexOf('COMMIT');
    for (const i of [insert, token, mail]) assert.ok(i > begin && i < commit, `statement ${i} inside the transaction`);

    const [userId, purpose, hash, expiresAt] = params[token] as [string, string, string, Date];
    assert.equal(userId, 'u-9');
    assert.equal(purpose, 'reset_password');
    const days = (expiresAt.getTime() - Date.now()) / 86_400_000;
    assert.ok(days > 6.99 && days <= 7, `expires in ${days} days`);

    const [mailUser, to, template, subject, html, text] = params[mail] as string[];
    assert.equal(mailUser, 'u-9');
    assert.equal(to, member.email);
    assert.equal(template, 'team-invite');
    assert.match(subject, /Acme <Retail>/);
    assert.match(html, /Acme &lt;Retail&gt;/);
    assert.doesNotMatch(html, /<Retail>/);
    assert.match(text, /Ira Boss added you/);
    const raw = /\/auth\/reset\?token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';
    assert.ok(raw.length > 20);
    assert.equal(hash, sha256Hex(raw)); // only the hash is stored
    assert.match(text, /^Set your password: https:\/\/app\.example\.test\/auth\/reset\?token=/m);
  });

  it('maps tenants to the camelCase Tenant shape', async () => {
    const { pool } = fakePool([{ rows: [{
      id: 'T1', name: 'Acme', industry: 'Retail', plan: 'Growth', credits: 40, seats: 5,
      domain: null, retention_months: 12, sso_enabled: false,
    }] }]);
    assert.deepEqual(await tenantsService(pool).findOne('T1'), {

      id: 'T1', name: 'Acme', industry: 'Retail', plan: 'Growth', credits: 40, seats: 5,
      domain: '', retentionMonths: 12, ssoEnabled: false,
    });
  });
});
