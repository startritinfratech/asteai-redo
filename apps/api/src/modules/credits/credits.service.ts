import { BadRequestException, HttpException, HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { paginate } from '../../common/utils/pagination';
import type {
  CreditCharge, CreditTransactionView, CreditTxStatus, CreditTxType, InsufficientCreditsBody, SubscriptionTier, WalletView,
} from './credits.contracts';
import { allocateFifo, allocationsOf, InsufficientCreditsError, planRefund, type Allocation } from './fifo';

type Db = Pick<PoolClient, 'query'>;

/** How long credits survive when a refund cannot go back into an expired lot. */
const REISSUE_DAYS = 30;

interface WalletRow {
  balance: number;
  subscription_tier: SubscriptionTier;
  subscription_status: string | null;
  current_period_end: Date | null;
}

interface LotRow {
  id: string;
  remaining_amount: number;
  expires_at: Date | null;
  created_at: Date;
  db_now: Date;
}

interface TxRow {
  id: string;
  type: CreditTxType;
  amount: number;
  remaining_amount: number;
  expires_at: Date | null;
  feature_key: string | null;
  status: CreditTxStatus;
  created_at: Date;
}

export interface GrantInput {
  type: 'grant' | 'topup';
  amount: number;
  expiresAt?: Date | null;
  /** Idempotency key (payment id, …): a second grant with the same key is a no-op. */
  reference?: string;
  featureKey?: string;
  metadata?: Record<string, unknown>;
}

export function insufficientCredits(required: number, balance: number): HttpException {
  // HttpExceptionFilter passes `message` and `errors` through to the client.
  const body: InsufficientCreditsBody = {
    message: `This needs ${required} credits; you have ${balance}.`,
    errors: { code: 'INSUFFICIENT_CREDITS', required, balance },
  };
  return new HttpException(body, HttpStatus.PAYMENT_REQUIRED);
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

function mapWallet(r: WalletRow): WalletView {
  return {
    balance: Number(r.balance),
    subscriptionTier: r.subscription_tier,
    subscriptionStatus: r.subscription_status,
    currentPeriodEnd: iso(r.current_period_end),
  };
}

function mapTx(r: TxRow): CreditTransactionView {
  return {
    id: r.id,
    type: r.type,
    amount: Number(r.amount),
    remainingAmount: Number(r.remaining_amount),
    expiresAt: iso(r.expires_at),
    featureKey: r.feature_key,
    status: r.status,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

const describe = (err: unknown) => (err instanceof Error ? err.message : String(err)).slice(0, 300);

/**
 * The credit ledger. Every change runs in one transaction that first locks the user's
 * wallet row (so concurrent spends of one user serialize), expires stale lots, then
 * changes lots and `wallets.balance` together. See migration 022 for the table layout.
 */
@Injectable()
export class CreditsService {
  private readonly logger = new Logger(CreditsService.name);

  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  // ── Reads ──────────────────────────────────────────────────────────────────

  getWallet(userId: string): Promise<WalletView> {
    return withTransaction(this.db, async (c) => mapWallet(await this.lockWallet(c, userId)));
  }

  async listTransactions(userId: string, page?: string): Promise<CreditTransactionView[]> {
    const { pageSize, offset } = paginate(page, undefined, 50, 100);
    const { rows } = await this.db.query<TxRow>(
      `SELECT id, type, amount, remaining_amount, expires_at, feature_key, status, created_at
         FROM credit_transactions WHERE user_id = $1
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [userId, pageSize, offset],
    );
    return rows.map(mapTx);
  }

  /** The advertised cost of a metered feature (credit_costs, the same table /pricing shows). */
  async costOf(featureKey: string): Promise<number> {
    const { rows } = await this.db.query<{ cost: number }>(`SELECT cost FROM credit_costs WHERE feature = $1`, [featureKey]);
    if (!rows.length) throw new Error(`Unknown metered feature "${featureKey}"`);
    return Number(rows[0].cost);
  }

  // ── Spend / refund ─────────────────────────────────────────────────────────

  /**
   * Deducts `cost` credits FIFO (oldest live lot first). All or nothing: 402 with an
   * INSUFFICIENT_CREDITS body when the wallet cannot cover it. Returns the spend id that
   * refundSpend() takes if the paid-for work fails.
   */
  async consumeCredits(userId: string, cost: number, featureKey: string): Promise<CreditCharge> {
    if (!Number.isInteger(cost) || cost <= 0) throw new BadRequestException('cost must be a positive integer');
    return withTransaction(this.db, async (c) => {
      const wallet = await this.lockWallet(c, userId);
      const { rows } = await c.query<LotRow>(
        `SELECT id, remaining_amount, expires_at, created_at, NOW() AS db_now
           FROM credit_transactions
          WHERE user_id = $1 AND type IN ('grant', 'topup', 'refund') AND status = 'completed'
            AND remaining_amount > 0 AND (expires_at IS NULL OR expires_at > NOW())
          ORDER BY created_at, id
          FOR UPDATE`,
        [userId],
      );

      let allocations: Allocation[];
      try {
        allocations = allocateFifo(
          rows.map((r) => ({
            id: r.id, remaining: Number(r.remaining_amount), expiresAt: r.expires_at, createdAt: new Date(r.created_at),
          })),
          cost,
          rows[0]?.db_now ? new Date(rows[0].db_now) : new Date(),
        );
      } catch (err) {
        if (err instanceof InsufficientCreditsError) throw insufficientCredits(cost, Number(wallet.balance));
        throw err;
      }

      await c.query(
        `UPDATE credit_transactions t SET remaining_amount = t.remaining_amount - v.amt
           FROM unnest($1::uuid[], $2::int[]) AS v(id, amt) WHERE t.id = v.id`,
        [allocations.map((a) => a.lotId), allocations.map((a) => a.amount)],
      );
      const spend = await c.query<{ id: string }>(
        `INSERT INTO credit_transactions (user_id, type, amount, feature_key, status, metadata)
         VALUES ($1, 'spend', $2, $3, 'completed', $4::jsonb) RETURNING id`,
        [userId, -cost, featureKey, JSON.stringify({ allocations })],
      );
      const balance = await this.addBalance(c, userId, -cost);
      return { transactionId: spend.rows[0].id, cost, featureKey, balance };
    });
  }

  /**
   * Gives a spend back, atomically and at most once: only the call that flips the spend
   * from `completed` to `refunded` refunds; any later call returns null. Credits return to
   * the lots they came from, or to a new 30-day lot for any lot that expired meanwhile.
   */
  async refundSpend(spendId: string, reason = 'task_failed'): Promise<{ refundId: string; balance: number } | null> {
    return withTransaction(this.db, async (c) => {
      const flipped = await c.query<{ user_id: string; amount: number; feature_key: string | null; metadata: unknown }>(
        `UPDATE credit_transactions
            SET status = 'refunded', metadata = metadata || jsonb_build_object('refundReason', $2::text)
          WHERE id = $1 AND type = 'spend' AND status = 'completed'
          RETURNING user_id, amount, feature_key, metadata`,
        [spendId, reason.slice(0, 300)],
      );
      if (!flipped.rows.length) return null;
      const spend = flipped.rows[0];
      const cost = -Number(spend.amount);
      const allocations = allocationsOf(spend.metadata);

      await this.lockWallet(c, spend.user_id);
      const { rows: lots } = await c.query<{ id: string; expires_at: Date | null; db_now: Date }>(
        `SELECT id, expires_at, NOW() AS db_now FROM credit_transactions
          WHERE id = ANY($1::uuid[]) AND user_id = $2 AND status = 'completed'
          FOR UPDATE`,
        [allocations.map((a) => a.lotId), spend.user_id],
      );
      const plan = planRefund(
        allocations,
        new Map(lots.map((l) => [l.id, l.expires_at ? new Date(l.expires_at) : null])),
        lots[0]?.db_now ? new Date(lots[0].db_now) : new Date(),
      );
      // Credits the spend's metadata cannot place (none recorded) are reissued too.
      const placed = allocations.reduce((s, a) => s + a.amount, 0);
      const reissue = plan.reissue + Math.max(0, cost - placed);

      if (plan.restore.length) {
        await c.query(
          `UPDATE credit_transactions t SET remaining_amount = t.remaining_amount + v.amt
             FROM unnest($1::uuid[], $2::int[]) AS v(id, amt) WHERE t.id = v.id`,
          [plan.restore.map((a) => a.lotId), plan.restore.map((a) => a.amount)],
        );
      }
      const refund = await c.query<{ id: string }>(
        `INSERT INTO credit_transactions
           (user_id, type, amount, remaining_amount, expires_at, feature_key, status, reference, metadata)
         VALUES ($1, 'refund', $2, $3,
                 CASE WHEN $3 > 0 THEN NOW() + make_interval(days => $4) END,
                 $5, 'completed', $6, $7::jsonb)
         RETURNING id`,
        [spend.user_id, cost, reissue, REISSUE_DAYS, spend.feature_key, spendId, JSON.stringify({ restored: plan.restore, reason })],
      );
      const balance = await this.addBalance(c, spend.user_id, cost);
      return { refundId: refund.rows[0].id, balance };
    });
  }

  /**
   * The auto-refund hook: charges `featureKey` (its credit_costs price unless `cost` is
   * given), runs the task, and refunds the charge if the task throws. The error is
   * rethrown unchanged; a refund that itself fails is logged with the spend id.
   */
  async runMetered<T>(
    userId: string, featureKey: string, task: (charge: CreditCharge) => Promise<T>, cost?: number,
  ): Promise<T> {
    const charge = await this.consumeCredits(userId, cost ?? (await this.costOf(featureKey)), featureKey);
    try {
      return await task(charge);
    } catch (err) {
      await this.refundAfterFailure(charge, err);
      throw err;
    }
  }

  /** Used by runMetered and CreditChargeInterceptor. Never throws. */
  async refundAfterFailure(charge: CreditCharge, err: unknown): Promise<void> {
    try {
      await this.refundSpend(charge.transactionId, `task_failed: ${describe(err)}`);
    } catch (refundErr) {
      this.logger.error(
        `Auto-refund of spend ${charge.transactionId} (${charge.cost} credits, ${charge.featureKey}) failed: ${describe(refundErr)}`,
      );
    }
  }

  // ── Credit in ──────────────────────────────────────────────────────────────

  /** Adds a lot. With `reference`, a repeat (webhook retry) returns null and changes nothing. */
  async grantCredits(userId: string, input: GrantInput, db?: Db): Promise<{ transactionId: string; balance: number } | null> {
    if (!Number.isInteger(input.amount) || input.amount <= 0) throw new BadRequestException('amount must be a positive integer');
    const run = async (c: Db) => {
      await this.lockWallet(c, userId);
      const { rows } = await c.query<{ id: string }>(
        `INSERT INTO credit_transactions
           (user_id, type, amount, remaining_amount, expires_at, feature_key, status, reference, metadata)
         VALUES ($1, $2, $3, $3, $4, $5, 'completed', $6, $7::jsonb)
         ON CONFLICT (type, reference) WHERE reference IS NOT NULL DO NOTHING
         RETURNING id`,
        [userId, input.type, input.amount, input.expiresAt ?? null, input.featureKey ?? null,
          input.reference ?? null, JSON.stringify(input.metadata ?? {})],
      );
      if (!rows.length) return null;
      return { transactionId: rows[0].id, balance: await this.addBalance(c, userId, input.amount) };
    };
    return db ? run(db) : withTransaction(this.db, run);
  }

  /** A top-up order waiting for payment: a `pending` lot with no spendable credits yet. */
  async createPendingTopup(userId: string, orderId: string, credits: number, meta: { packId: string; priceMinor: number }) {
    await this.db.query(
      `INSERT INTO credit_transactions (user_id, type, amount, remaining_amount, status, reference, metadata)
       VALUES ($1, 'topup', $2, 0, 'pending', $3, $4::jsonb)`,
      [userId, credits, orderId, JSON.stringify(meta)],
    );
  }

  /**
   * Credits a paid top-up once. `paidMinor` (from the webhook) must equal the pack price;
   * `userId` (from the checkout callback) must own the order. Safe to call from both the
   * webhook and the browser callback, in any order.
   */
  async completeTopup(
    orderId: string, paymentId: string, check: { paidMinor?: number; userId?: string } = {},
  ): Promise<'credited' | 'duplicate' | 'unknown' | 'amount_mismatch'> {
    return withTransaction(this.db, async (c) => {
      const { rows } = await c.query<{ id: string; user_id: string; amount: number; status: string; metadata: { priceMinor?: number } }>(
        `SELECT id, user_id, amount, status, metadata FROM credit_transactions
          WHERE type = 'topup' AND reference = $1 FOR UPDATE`,
        [orderId],
      );
      const row = rows[0];
      if (!row || (check.userId && row.user_id !== check.userId)) return 'unknown';
      if (row.status !== 'pending') return 'duplicate';
      if (check.paidMinor !== undefined && check.paidMinor !== Number(row.metadata?.priceMinor)) return 'amount_mismatch';

      await this.lockWallet(c, row.user_id);
      await c.query(
        `UPDATE credit_transactions
            SET status = 'completed', remaining_amount = amount,
                metadata = metadata || jsonb_build_object('paymentId', $2::text)
          WHERE id = $1`,
        [row.id, paymentId],
      );
      await this.addBalance(c, row.user_id, Number(row.amount));
      return 'credited';
    });
  }

  // ── Internals ──────────────────────────────────────────────────────────────

  /**
   * Creates the wallet on first use, locks it, and zeroes lots past their expiry
   * (taking them off the balance). Returns the wallet as it stands after that.
   */
  async lockWallet(c: Db, userId: string): Promise<WalletRow> {
    await c.query(`INSERT INTO wallets (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
    await c.query(`SELECT 1 FROM wallets WHERE user_id = $1 FOR UPDATE`, [userId]);
    const { rows } = await c.query<WalletRow>(
      `WITH stale AS (
         SELECT id, remaining_amount FROM credit_transactions
          WHERE user_id = $1 AND remaining_amount > 0 AND expires_at <= NOW()
          FOR UPDATE
       ), zeroed AS (
         UPDATE credit_transactions t SET remaining_amount = 0, status = 'expired'
           FROM stale WHERE t.id = stale.id
         RETURNING stale.remaining_amount AS amt
       )
       UPDATE wallets
          SET balance = balance - COALESCE((SELECT SUM(amt) FROM zeroed), 0)::int,
              updated_at = NOW()
        WHERE user_id = $1
        RETURNING balance, subscription_tier, subscription_status, current_period_end`,
      [userId],
    );
    return rows[0];
  }

  private async addBalance(c: Db, userId: string, delta: number): Promise<number> {
    const { rows } = await c.query<{ balance: number }>(
      `UPDATE wallets SET balance = balance + $2, updated_at = NOW() WHERE user_id = $1 RETURNING balance`,
      [userId, delta],
    );
    return Number(rows[0]?.balance ?? 0);
  }
}
