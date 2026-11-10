import { Injectable, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { DB_POOL } from '../../database/database.module';
import type { LedgerEntry, WalletSummary } from '@asteai/types';
import { generateId } from '../../common/utils/ids';
import { LedgerRow, mapLedgerRow } from './ledger.mapper';

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

  async getWallet(userId: string): Promise<WalletSummary> {
    const { rows } = await this.db.query<{ earned: string; fees: string; pending: string }>(
      `SELECT
         COALESCE(SUM(CASE WHEN type IN ('Escrow release', 'Deposit') THEN amount ELSE 0 END), 0) AS earned,
         COALESCE(SUM(CASE WHEN type = 'Fee' THEN ABS(amount) ELSE 0 END), 0) AS fees,
         COALESCE(SUM(CASE WHEN type = 'Escrow hold' THEN ABS(amount) ELSE 0 END), 0) AS pending
       FROM ledger_entries WHERE user_id = $1`,
      [userId],
    );
    const row = rows[0];
    return {
      earned: Number(row?.earned ?? 0),
      fees: Number(row?.fees ?? 0),
      pending: Number(row?.pending ?? 0),
    };
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
