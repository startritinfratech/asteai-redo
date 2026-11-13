import {
  BadRequestException, ConflictException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { Pagination } from '../../common/utils/pagination';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { deriveKey } from '../auth/totp';
import { EmailService } from '../email/email.service';
import { LedgerService } from '../ledger/ledger.service';
import { NotificationsService } from '../notifications/notifications.service';
import {
  DEFAULT_PAYOUT_MIN, type PayoutAccount, type PayoutAccountInput, type PayoutDestination, type PayoutOverview,
  type PayoutRequest, type PayoutStatus,
} from '../ledger/billing-types';
import { maskAccount, openDetails, parsePayoutAccount, sealDetails } from './payout-account';
import { mapPayoutAccount, mapPayoutRequest, PayoutAccountRow, PayoutRequestRow } from './payout.mapper';

const WALLET_LINK = '/platform/wallet';

const toMinor = (amount: number) => Math.round(amount * 100);

export function formatInr(amount: number, currency = 'INR'): string {
  return new Intl.NumberFormat('en-IN', { style: 'currency', currency, minimumFractionDigits: 2 }).format(amount);
}

const actorName = (u: User) => [u.firstName, u.lastName].filter(Boolean).join(' ');

/**
 * Expert payouts. An expert keeps one payout account (bank or UPI, sealed at rest) and asks
 * to withdraw from the available wallet balance; an admin approves, transfers the money by
 * hand outside the app (RazorpayX is not wired), then records the bank reference (UTR),
 * which writes the 'Payout' ledger row. Or rejects, with a note.
 *
 *   requested ──approve──▶ approved ──mark-paid──▶ paid
 *       │                     │
 *       ├──reject─────────────┴──▶ rejected
 *       └──cancel (owner)──▶ cancelled
 *
 * Double spending is prevented by locking the expert's payout_accounts row for the whole
 * request transaction (balance check + insert), plus a unique index allowing one open
 * request per expert.
 */
@Injectable()
export class PayoutsService {
  private readonly logger = new Logger(PayoutsService.name);
  private warnedDevKey = false;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly config: ConfigService,
    private readonly ledger: LedgerService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  // ── Configuration ──────────────────────────────────────────────────────────

  /** AES-256-GCM key for payout details: from PAYOUT_ENCRYPTION_KEY, or JWT_SECRET in development. */
  private payoutKey(): Buffer {
    const configured = this.config.get<string>('PAYOUT_ENCRYPTION_KEY');
    if (configured) return deriveKey(configured, 'payout-details-v1');
    if (this.config.get<string>('NODE_ENV') === 'production') {
      throw new InternalServerErrorException('Payouts are not configured');
    }
    if (!this.warnedDevKey) {
      this.warnedDevKey = true;
      this.logger.warn('PAYOUT_ENCRYPTION_KEY is not set: deriving the payout key from JWT_SECRET (development only)');
    }
    return deriveKey(this.config.getOrThrow<string>('JWT_SECRET'), 'payout-details-dev-v1');
  }

  /** PAYOUT_MIN (INR), default 500. */
  minimum(): number {
    const raw = Number(this.config.get<string>('PAYOUT_MIN'));
    return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_PAYOUT_MIN;
  }

  // ── Payout account ─────────────────────────────────────────────────────────

  async getAccount(userId: string): Promise<PayoutAccount | null> {
    const { rows } = await this.db.query<PayoutAccountRow>(`SELECT * FROM payout_accounts WHERE user_id = $1`, [userId]);
    return rows[0] ? mapPayoutAccount(rows[0]) : null;
  }

  /** Creates or replaces the expert's payout account. Any change clears `verified`. */
  async saveAccount(user: User, input: PayoutAccountInput): Promise<PayoutAccount> {
    const parsed = parsePayoutAccount(input);
    if (!parsed.account) throw new BadRequestException(parsed.error);
    const account = parsed.account;
    const masked = maskAccount(account);
    const sealed = sealDetails(account, user.id, this.payoutKey());
    const { rows } = await this.db.query<PayoutAccountRow>(
      `INSERT INTO payout_accounts (user_id, method, account_holder, details_encrypted, account_last4, ifsc, upi_masked)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (user_id) DO UPDATE
         SET method = EXCLUDED.method, account_holder = EXCLUDED.account_holder,
             details_encrypted = EXCLUDED.details_encrypted, account_last4 = EXCLUDED.account_last4,
             ifsc = EXCLUDED.ifsc, upi_masked = EXCLUDED.upi_masked, verified = FALSE, updated_at = NOW()
       RETURNING *`,
      [user.id, account.method, account.accountHolder, sealed, masked.last4, masked.ifsc, masked.upiMasked],
    );
    return mapPayoutAccount(rows[0]);
  }

  // ── Expert requests ────────────────────────────────────────────────────────

  async overview(userId: string): Promise<PayoutOverview> {
    const wallet = await this.ledger.getWallet(userId);
    const { rows } = await this.db.query<PayoutRequestRow>(
      `SELECT * FROM payout_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 50`,
      [userId],
    );
    return { minimum: this.minimum(), available: wallet.expert.available, requests: rows.map(mapPayoutRequest) };
  }

  /** Asks to withdraw `amount` (INR) from the available balance. */
  async request(user: User, amount: number): Promise<PayoutRequest> {
    const min = this.minimum();
    if (!Number.isFinite(amount) || amount <= 0) throw new BadRequestException('amount must be a positive number');
    if (toMinor(amount) < toMinor(min)) throw new BadRequestException(`The minimum payout is ${formatInr(min)}`);

    try {
      return await withTransaction(this.db, async (client) => {
        // Serialises this expert's requests: a second concurrent request waits here, then
        // sees the first one (open request / reduced balance).
        const { rows: accounts } = await client.query<PayoutAccountRow>(
          `SELECT * FROM payout_accounts WHERE user_id = $1 FOR UPDATE`,
          [user.id],
        );
        const account = accounts[0];
        if (!account) throw new BadRequestException('Add a payout account before requesting a payout');

        const { rows: open } = await client.query<{ id: string }>(
          `SELECT id FROM payout_requests WHERE user_id = $1 AND status IN ('requested', 'approved') LIMIT 1`,
          [user.id],
        );
        if (open.length) throw new ConflictException('You already have a payout request in progress');

        const wallet = await this.ledger.getWallet(user.id, client);
        if (toMinor(amount) > toMinor(wallet.expert.available)) {
          throw new BadRequestException(`The amount is more than your available balance (${formatInr(wallet.expert.available)})`);
        }

        const masked = mapPayoutAccount(account).masked;
        const { rows } = await client.query<PayoutRequestRow>(
          `INSERT INTO payout_requests (user_id, amount, currency, method, account_holder, account_masked, details_encrypted)
           VALUES ($1, $2, 'INR', $3, $4, $5, $6) RETURNING *`,
          [user.id, amount, account.method, account.account_holder, masked, account.details_encrypted],
        );
        return mapPayoutRequest(rows[0]);
      });
    } catch (err) {
      if (isUniqueViolation(err)) throw new ConflictException('You already have a payout request in progress');
      throw err;
    }
  }

  /** The owner withdraws a request an admin has not acted on yet. */
  async cancel(user: User, id: string): Promise<PayoutRequest> {
    const { rows } = await this.db.query<PayoutRequestRow>(
      `UPDATE payout_requests SET status = 'cancelled', decided_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND user_id = $2 AND status = 'requested' RETURNING *`,
      [id, user.id],
    );
    if (rows[0]) return mapPayoutRequest(rows[0]);
    const { rows: existing } = await this.db.query<{ status: PayoutStatus }>(
      `SELECT status FROM payout_requests WHERE id = $1 AND user_id = $2`,
      [id, user.id],
    );
    if (!existing[0]) throw new NotFoundException('Payout request not found');
    throw new ConflictException(`A payout request that is '${existing[0].status}' cannot be cancelled`);
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listForAdmin(status: PayoutStatus | undefined, page: Pagination): Promise<PayoutRequest[]> {
    const { rows } = await this.db.query<PayoutRequestRow>(
      `SELECT r.*, TRIM(CONCAT_WS(' ', u.first_name, u.last_name)) AS user_name, u.email AS user_email
         FROM payout_requests r JOIN user_accounts u ON u.id = r.user_id
        WHERE ($1::text IS NULL OR r.status = $1)
        ORDER BY (r.status IN ('requested', 'approved')) DESC, r.requested_at ASC
        LIMIT $2 OFFSET $3`,
      [status ?? null, page.pageSize, page.offset],
    );
    return rows.map(mapPayoutRequest);
  }

  /** The unmasked destination of a request, for the admin making the transfer. Audited. */
  async destination(admin: User, id: string): Promise<PayoutDestination> {
    const row = await this.findRow(this.db, id);
    let details: PayoutDestination;
    try {
      details = openDetails(row.details_encrypted, row.user_id, this.payoutKey(), row.method, row.account_holder);
    } catch (err) {
      if (err instanceof InternalServerErrorException) throw err;
      this.logger.error(`Payout ${id}: sealed details could not be opened`);
      throw new InternalServerErrorException('The payout details could not be decrypted');
    }
    await this.audit(this.db, admin, 'Payout details viewed', id, {});
    return details;
  }

  async approve(admin: User, id: string): Promise<PayoutRequest> {
    return withTransaction(this.db, async (client) => {
      const row = await this.findRow(client, id, true);
      if (row.status !== 'requested') throw new ConflictException(`A '${row.status}' payout cannot be approved`);
      const { rows } = await client.query<PayoutRequestRow>(
        `UPDATE payout_requests SET status = 'approved', decided_at = NOW(), decided_by = $2, updated_at = NOW()
          WHERE id = $1 AND status = 'requested' RETURNING *`,
        [id, admin.id],
      );
      await this.audit(client, admin, 'Payout approved', id, { amount: Number(row.amount), userId: row.user_id });
      return mapPayoutRequest(rows[0]);
    });
  }

  /**
   * Records that the admin transferred the money (`reference`: bank UTR / UPI reference) and
   * debits the wallet with one 'Payout' ledger row. Repeating the call with the same
   * reference returns the paid request without writing anything.
   */
  async markPaid(admin: User, id: string, reference: string): Promise<PayoutRequest> {
    const ref = reference.trim();
    const outcome = await withTransaction(this.db, async (client) => {
      const row = await this.findRow(client, id, true);
      if (row.status === 'paid') {
        if (row.reference !== ref) throw new ConflictException(`This payout was already marked paid with reference ${row.reference}`);
        return { request: row, changed: false };
      }
      if (row.status !== 'approved') throw new ConflictException(`A '${row.status}' payout cannot be marked paid; approve it first`);

      const { rows } = await client.query<PayoutRequestRow>(
        `UPDATE payout_requests
            SET status = 'paid', reference = $2, paid_at = NOW(), decided_at = NOW(), decided_by = $3, updated_at = NOW()
          WHERE id = $1 AND status = 'approved' RETURNING *`,
        [id, ref, admin.id],
      );
      const paid = rows[0];
      await client.query(
        `INSERT INTO ledger_entries (id, tenant_id, user_id, type, description, amount, unit, payee_id, by, ref)
         VALUES ($1, NULL, $2, 'Payout', $3, $4, $5, $2, $6, $7)
         ON CONFLICT (ref) WHERE type = 'Payout' DO NOTHING`,
        [
          generateId('TX'), paid.user_id, `Payout to ${paid.account_masked} (ref ${ref})`,
          -Number(paid.amount), paid.currency.trim(), admin.id, paid.id,
        ],
      );
      // A payout to these exact details went through: the account is verified, unless
      // the expert has replaced it since the request (the sealed value would differ).
      await client.query(
        `UPDATE payout_accounts SET verified = TRUE WHERE user_id = $1 AND details_encrypted = $2`,
        [paid.user_id, paid.details_encrypted],
      );
      await this.audit(client, admin, 'Payout marked paid', id, { amount: Number(paid.amount), userId: paid.user_id, reference: ref });
      return { request: paid, changed: true };
    });

    if (outcome.changed) {
      const r = outcome.request;
      const amount = formatInr(Number(r.amount), r.currency.trim());
      await this.tell(r.user_id, `Your payout of ${amount} was paid (reference ${ref})`, async (to, firstName) =>
        this.email.enqueue('payout-paid', to, { firstName, amount, reference: ref, path: WALLET_LINK }, {
          userId: r.user_id, dedupeKey: `payout-paid:${r.id}`,
        }));
    }
    return mapPayoutRequest(outcome.request);
  }

  async reject(admin: User, id: string, note: string): Promise<PayoutRequest> {
    const text = note.trim();
    const rejected = await withTransaction(this.db, async (client) => {
      const row = await this.findRow(client, id, true);
      if (row.status !== 'requested' && row.status !== 'approved') {
        throw new ConflictException(`A '${row.status}' payout cannot be rejected`);
      }
      const { rows } = await client.query<PayoutRequestRow>(
        `UPDATE payout_requests SET status = 'rejected', admin_note = $2, decided_at = NOW(), decided_by = $3, updated_at = NOW()
          WHERE id = $1 AND status IN ('requested', 'approved') RETURNING *`,
        [id, text, admin.id],
      );
      await this.audit(client, admin, 'Payout rejected', id, { amount: Number(row.amount), userId: row.user_id, note: text });
      return rows[0];
    });

    const amount = formatInr(Number(rejected.amount), rejected.currency.trim());
    await this.tell(rejected.user_id, `Your payout request of ${amount} was rejected: ${text}`, async (to, firstName) =>
      this.email.enqueue('payout-rejected', to, { firstName, amount, note: text, path: WALLET_LINK }, {
        userId: rejected.user_id, dedupeKey: `payout-rejected:${rejected.id}`,
      }));
    return mapPayoutRequest(rejected);
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private async findRow(db: Pool | PoolClient, id: string, lock = false): Promise<PayoutRequestRow> {
    const { rows } = await db.query<PayoutRequestRow>(
      `SELECT * FROM payout_requests WHERE id = $1${lock ? ' FOR UPDATE' : ''}`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException('Payout request not found');
    return rows[0];
  }

  private async audit(db: Pool | PoolClient, admin: User, action: string, id: string, meta: Record<string, unknown>) {
    await db.query(
      `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta) VALUES ($1, $2, $3, $4, $5, $6)`,
      [admin.id, actorName(admin), admin.role, action, `payout:${id}`, JSON.stringify(meta)],
    );
  }

  /** In-app notification and email after a decision; failures are logged, not thrown (the decision is committed). */
  private async tell(userId: string, text: string, sendEmail: (to: string, firstName: string) => Promise<unknown>) {
    try {
      await this.notifications.send(userId, text, WALLET_LINK);
    } catch (err) {
      this.logger.warn(`Notification to ${userId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    try {
      const { rows } = await this.db.query<{ email: string; first_name: string | null }>(
        `SELECT email, first_name FROM user_accounts WHERE id = $1`,
        [userId],
      );
      if (rows[0]?.email) await sendEmail(rows[0].email, rows[0].first_name ?? '');
    } catch (err) {
      this.logger.warn(`Payout email to ${userId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
