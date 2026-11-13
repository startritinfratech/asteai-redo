import { Injectable, Inject } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DB_POOL } from '../../database/database.module';
import type { LedgerEntry } from '@asteai/types';
import type { WalletBalances } from './billing-types';
import { generateId } from '../../common/utils/ids';
import { LedgerRow, WalletGroupRow, mapLedgerRow, mapWalletGroup } from './ledger.mapper';
import { computeWallet, contractIdsOfRefs } from './wallet';

type Queryable = Pick<Pool | PoolClient, 'query'>;

@Injectable()
export class LedgerService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findForTenant(tenantId: string, pageSize: number, offset: number): Promise<LedgerEntry[]> {
    const { rows } = await this.db.query<LedgerRow>(
      `SELECT * FROM ledger_entries WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
      [tenantId, pageSize, offset],
    );
    return rows.map(mapLedgerRow);
  }

  async findForUser(userId: string): Promise<LedgerEntry[]> {
    const { rows } = await this.db.query<LedgerRow>(
      `SELECT * FROM ledger_entries WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return rows.map(mapLedgerRow);
  }

  /**
   * The user's wallet in INR (see wallet.ts for the arithmetic). Pass `db` to read inside a
   * transaction, e.g. the payout request that must see the balance it is about to reserve.
   */
  async getWallet(userId: string, db: Queryable = this.db): Promise<WalletBalances> {
    // Every row that touches the user, plus releases of escrow they funded
    // (those rows belong to the expert, so only their ref links them to the buyer). A buyer's
    // refunds are their own rows (user_id = buyer).
    const { rows } = await db.query<WalletGroupRow>(
      `SELECT type, ref, user_id, payee_id, SUM(amount) AS total
         FROM ledger_entries
        WHERE COALESCE(unit, 'INR') = 'INR'
          AND (user_id = $1 OR payee_id = $1
               OR (type = 'Escrow release' AND ref IN (
                     SELECT h.ref FROM ledger_entries h
                      WHERE h.type = 'Escrow hold' AND h.ref IS NOT NULL AND (h.user_id = $1 OR h.payee_id = $1))))
        GROUP BY type, ref, user_id, payee_id`,
      [userId],
    );
    const groups = rows.map(mapWalletGroup);
    const holdRefs = groups.filter((g) => g.type === 'Escrow hold').map((g) => g.ref);

    const { rows: settled } = await db.query<{ ref: string }>(
      `SELECT contract_id || '/' || id::text AS ref FROM contract_milestones
        WHERE contract_id = ANY($1::varchar[]) AND status IN ('cancelled', 'released')`,
      [contractIdsOfRefs(holdRefs)],
    );
    const { rows: pending } = await db.query<{ pending: string | number }>(
      `SELECT COALESCE(SUM(amount), 0) AS pending FROM payout_requests
        WHERE user_id = $1 AND currency = 'INR' AND status IN ('requested', 'approved')`,
      [userId],
    );

    return computeWallet(userId, {
      groups,
      settledRefs: new Set(settled.map((r) => r.ref)),
      payoutsPending: Number(pending[0]?.pending ?? 0),
    });
  }

  async record(entry: {
    tenantId?: string; userId?: string; type: string; description: string;
    amount: number; unit?: string; payeeId?: string; fee?: number; by: string; ref?: string;
  }): Promise<LedgerEntry> {
    const id = generateId('TX');
    const { rows } = await this.db.query<LedgerRow>(
      `INSERT INTO ledger_entries
         (id, tenant_id, user_id, type, description, amount, unit, payee_id, fee, by, ref)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [
        id, entry.tenantId, entry.userId, entry.type, entry.description,
        entry.amount, entry.unit, entry.payeeId, entry.fee, entry.by, entry.ref,
      ],
    );
    return mapLedgerRow(rows[0]);
  }
}
