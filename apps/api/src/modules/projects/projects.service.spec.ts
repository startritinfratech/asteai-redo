import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import { ProjectsController } from './projects.controller';
import { ProjectsService } from './projects.service';
import { canMoveProjectStage, type ProjectParty } from './project-transitions';

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
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

const buyerParty: ProjectParty = { isAdmin: false, isBuyer: true, isFreelancer: false };
const freelancerParty: ProjectParty = { isAdmin: false, isBuyer: false, isFreelancer: true };
const adminParty: ProjectParty = { isAdmin: true, isBuyer: false, isFreelancer: false };

describe('project stage transitions', () => {
  it('lets the buyer move forward only', () => {
    assert.equal(canMoveProjectStage(buyerParty, 'Contracted', 'In Progress', true), true);
    assert.equal(canMoveProjectStage(buyerParty, 'In Progress', 'Contracted', true), false);
    assert.equal(canMoveProjectStage(buyerParty, 'Completed', 'Completed', true), false);
  });

  it("doesn't let the buyer contract a project without an award", () => {
    assert.equal(canMoveProjectStage(buyerParty, 'Open for Bids', 'Shortlisting', false), true);
    assert.equal(canMoveProjectStage(buyerParty, 'Open for Bids', 'Contracted', false), false);
    assert.equal(canMoveProjectStage(buyerParty, 'Shortlisting', 'Completed', false), false);
  });

  it('refuses the freelancer and lets admins move backwards', () => {
    assert.equal(canMoveProjectStage(freelancerParty, 'Contracted', 'In Progress', true), false);
    assert.equal(canMoveProjectStage(adminParty, 'Completed', 'In Progress', true), true);
  });
});

describe('PATCH /projects/:id/milestones/:milestoneId (retired)', () => {
  it('answers 410 Gone pointing at contracts, without touching the database', () => {
    const { pool, sql } = fakePool([]);
    const controller = new ProjectsController(new ProjectsService(pool));
    assert.throws(() => controller.updateMilestone(), (e: HttpException) => {
      assert.equal(e.getStatus(), 410);
      assert.match(e.message, /contracts/);
      return true;
    });
    assert.equal(sql.length, 0);
  });
});

describe('ProjectsService contract link', () => {
  it('returns contractId for the buyer list and the project detail', async () => {
    const row = {
      id: 'PRJ-1', buyer_id: 'buyer-1', awarded_to: 'fl-1', stage: 'Contracted', nda_required: false,
      milestones: [], created_at: '2026-01-01', contract_id: 'CT-1',
    };
    const { pool, sql } = fakePool([{ rows: [row] }, { rows: [row] }, { rows: [{ ...row, contract_id: null }] }]);
    const svc = new ProjectsService(pool);
    assert.equal((await svc.findForUser('buyer-1', 'buyer'))[0].contractId, 'CT-1');
    assert.equal((await svc.findOne('PRJ-1', { id: 'buyer-1', role: 'Buyer' } as User)).contractId, 'CT-1');
    assert.equal((await svc.findOne('PRJ-1', { id: 'buyer-1', role: 'Buyer' } as User)).contractId, null);
    assert.ok(sql.every((q) => /FROM contracts c WHERE c.project_id = p.id/.test(q)));
  });
});

describe('ProjectsService.findOne access', () => {
  const row = (over: Record<string, unknown>) => ({
    id: 'PRJ-1', buyer_id: 'buyer-1', awarded_to: null, stage: 'Open for Bids', nda_required: false,
    milestones: [], created_at: '2026-01-01', ...over,
  });
  const stranger = { id: 'x', role: 'Freelancer' } as User;

  it('shows an open, non-NDA project to anyone', async () => {
    const { pool } = fakePool([{ rows: [row({})] }]);
    assert.equal((await new ProjectsService(pool).findOne('PRJ-1', stranger)).id, 'PRJ-1');
  });

  it('hides NDA or contracted projects from strangers', async () => {
    for (const over of [{ nda_required: true }, { stage: 'Contracted', awarded_to: 'fl-1' }]) {
      const { pool } = fakePool([{ rows: [row(over)] }]);
      await assert.rejects(new ProjectsService(pool).findOne('PRJ-1', stranger), (e: HttpException) => e.getStatus() === 403);
    }
  });

  it('shows a contracted project to its awarded freelancer', async () => {
    const { pool } = fakePool([{ rows: [row({ stage: 'In Progress', awarded_to: 'fl-1', nda_required: true })] }]);
    assert.equal((await new ProjectsService(pool).findOne('PRJ-1', { id: 'fl-1', role: 'Freelancer' } as User)).id, 'PRJ-1');
  });
});
