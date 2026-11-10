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
const proposal = { id: 'P-1', project_id: 'PRJ-1', expert_id: 'fl-1' };

describe('ProposalsService.award', () => {
  for (const stage of ['Open for Bids', 'Shortlisting']) {
    it(`awards while the project is '${stage}'`, async () => {
      const { pool, sql } = fakePool([{ rows: [proposal] }, { rows: [{ buyer_id: 'buyer-1', stage }] }, { rows: [] }, { rows: [] }]);
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

  it("refuses someone else's project", async () => {
    const { pool } = fakePool([{ rows: [proposal] }, { rows: [{ buyer_id: 'other', stage: 'Open for Bids' }] }]);
    await assert.rejects(new ProposalsService(pool).award('P-1', buyer), (e: HttpException) => e.getStatus() === 403);
  });
});

describe('ProposalsService contract link', () => {
  it('returns contract_id for the buyer and the expert', async () => {
    const { pool, sql } = fakePool([
      { rows: [{ buyer_id: 'buyer-1' }] }, { rows: [{ id: 'P-1', contract_id: 'CT-1' }] },
      { rows: [{ id: 'P-1', contract_id: null }] },
    ]);
    const svc = new ProposalsService(pool);
    assert.equal((await svc.findForProject('PRJ-1', buyer))[0].contract_id, 'CT-1');
    assert.equal((await svc.findMine('fl-1'))[0].contract_id, null);
    assert.equal(sql.filter((q) => /LEFT JOIN contracts c ON c.proposal_id = p.id/.test(q)).length, 2);
  });
});
