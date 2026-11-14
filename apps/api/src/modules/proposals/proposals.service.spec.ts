import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import { ProposalsService } from './proposals.service';

/** A pool that answers queries in order from `replies` and records the SQL it saw. */
function fakePool(replies: { rows: unknown[] }[]) {
  const sql: string[] = [];
  const query = async (text: string) => {
    sql.push(text);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    const next = replies.shift() ?? { rows: [] };
    return { rowCount: next.rows.length, ...next };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql };
}

const buyer = { id: 'buyer-1', role: 'Buyer' } as User;
const proposal = { id: 'P-1', project_id: 'PRJ-1', expert_id: 'fl-1', status: 'Pending' };
const row = (over: Record<string, unknown> = {}) => ({
  id: 'P-1', project_id: 'PRJ-1', expert_id: 'fl-1', price: '45000.50', days: 10, note: null, status: 'Pending',
  created_at: new Date('2026-01-02T03:04:05Z'), updated_at: new Date('2026-01-02T03:04:05Z'), ...over,
});

describe('ProposalsService.award', () => {
  for (const stage of ['Open for Bids', 'Shortlisting']) {
    it(`awards while the project is '${stage}'`, async () => {
      const { pool, sql } = fakePool([
        { rows: [proposal] }, { rows: [{ buyer_id: 'buyer-1', stage }] }, { rows: [{ id: 'P-1' }, { id: 'P-2' }] }, { rows: [] },
      ]);
      const out = await new ProposalsService(pool).award('P-1', buyer);
      assert.deepEqual(out, { awarded: true, projectId: 'PRJ-1', expertId: 'fl-1' });
      assert.ok(sql.some((q) => /SET stage = 'Contracted'/.test(q)));
      assert.equal(sql.at(-1), 'COMMIT');
    });
  }

  for (const stage of ['Contracted', 'In Progress', 'Completed', 'Disputed']) {
    it(`refuses to award once the project is '${stage}'`, async () => {
      const { pool, sql } = fakePool([{ rows: [proposal] }, { rows: [{ buyer_id: 'buyer-1', stage }] }]);
      await assert.rejects(new ProposalsService(pool).award('P-1', buyer), (e: HttpException) => e.getStatus() === 409);
      assert.ok(!sql.some((q) => /^\s*UPDATE/.test(q)));
      assert.equal(sql.at(-1), 'ROLLBACK');
    });
  }

  for (const status of ['Declined', 'Withdrawn']) {
    it(`refuses a '${status}' proposal before locking anything`, async () => {
      const { pool, sql } = fakePool([{ rows: [{ ...proposal, status }] }]);
      await assert.rejects(new ProposalsService(pool).award('P-1', buyer), (e: HttpException) => e.getStatus() === 409);
      assert.ok(!sql.some((q) => /FOR UPDATE|^\s*UPDATE/.test(q)));
    });
  }

  it('keeps withdrawn/declined bids and refuses one withdrawn since it was read', async () => {
    const { pool, sql } = fakePool([{ rows: [proposal] }, { rows: [{ buyer_id: 'buyer-1', stage: 'Open for Bids' }] }, { rows: [] }]);
    await assert.rejects(new ProposalsService(pool).award('P-1', buyer), (e: HttpException) => e.getStatus() === 409);
    const update = sql.find((q) => /UPDATE proposals/.test(q)) ?? '';
    assert.match(update, /WHEN status = ANY\(\$3::text\[\]\) THEN status/);
    assert.match(update, /NOT EXISTS/);
    assert.ok(!sql.some((q) => /UPDATE projects/.test(q)));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  it("refuses someone else's project", async () => {
    const { pool } = fakePool([{ rows: [proposal] }, { rows: [{ buyer_id: 'other', stage: 'Open for Bids' }] }]);
    await assert.rejects(new ProposalsService(pool).award('P-1', buyer), (e: HttpException) => e.getStatus() === 403);
  });
});

describe('ProposalsService responses (camelCase Proposal)', () => {
  it('maps the buyer view with the expert name and contract id', async () => {
    const { pool, sql } = fakePool([
      { rows: [{ buyer_id: 'buyer-1' }] },
      { rows: [row({ expert_name: 'Fia Lancer', contract_id: 'CT-1', status: 'Awarded' })] },
    ]);
    const [out] = await new ProposalsService(pool).findForProject('PRJ-1', buyer);
    assert.deepEqual(out, {
      id: 'P-1', projectId: 'PRJ-1', expertId: 'fl-1', price: 45000.5, days: 10, note: '', status: 'Awarded',
      createdAt: '2026-01-02T03:04:05.000Z', updatedAt: '2026-01-02T03:04:05.000Z',
      expertName: 'Fia Lancer', contractId: 'CT-1', sow: null,
    });
    assert.match(sql[1], /LEFT JOIN contracts c ON c.proposal_id = p.id/);
  });

  it("maps the expert's own list with the project title, stage and contract id", async () => {
    const { pool } = fakePool([{ rows: [row({ project_title: 'Site', project_stage: 'Contracted', contract_id: null })] }]);
    const [out] = await new ProposalsService(pool).findMine('fl-1');
    assert.equal(out.projectTitle, 'Site');
    assert.equal(out.projectStage, 'Contracted');
    assert.equal(out.contractId, null);
    assert.equal(out.price, 45000.5);
    assert.ok(!('project_id' in out));
  });

  it('maps a submitted proposal, and the existing one on a repeat bid', async () => {
    const created = fakePool([{ rows: [{ stage: 'Open for Bids' }] }, { rows: [row()] }]);
    const dto = { projectId: 'PRJ-1', price: 45000.5, days: 10 };
    const first = await new ProposalsService(created.pool).submit(dto, { id: 'fl-1' } as User);
    assert.equal(first.price, 45000.5);
    assert.ok(!('contractId' in first));
    const repeat = fakePool([{ rows: [{ stage: 'Open for Bids' }] }, { rows: [] }, { rows: [row({ note: 'hi' })] }]);
    assert.equal((await new ProposalsService(repeat.pool).submit(dto, { id: 'fl-1' } as User)).note, 'hi');
  });
});

