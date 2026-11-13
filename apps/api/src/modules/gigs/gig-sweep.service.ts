import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { GIG_AUTO_ACCEPT_DAYS, GIG_REMINDER_DAYS } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { ContractsService } from '../contracts/contracts.service';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';

/** Every 10 minutes. */
export const GIG_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/** pg advisory lock key for the gig sweep (unique to this job; see DISPUTE_SWEEP_LOCK_KEY). */
export const GIG_SWEEP_LOCK_KEY = 724_113_014;
const BATCH = 200;

const orderLink = (id: string) => `/platform/orders/${encodeURIComponent(id)}`;

interface SweepOrder {
  id: string;
  contract_id: string;
  milestone_id: string;
  service_title: string;
  buyer_id: string;
  buyer_email: string | null;
  buyer_first_name: string | null;
  expert_id: string;
  expert_email: string | null;
  expert_first_name: string | null;
}

/** Orders of one kind joined with what the notices need. `where` and `order` are fixed fragments. */
const orderQuery = (where: string, order: string) => `
  SELECT o.id, o.contract_id, m.id AS milestone_id, s.title AS service_title,
         o.buyer_id, b.email AS buyer_email, b.first_name AS buyer_first_name,
         o.expert_id, e.email AS expert_email, e.first_name AS expert_first_name
    FROM gig_orders o
    JOIN services s ON s.id = o.service_id
    JOIN contracts c ON c.id = o.contract_id
    JOIN contract_milestones m ON m.contract_id = c.id AND m.seq = 1
    JOIN user_accounts b ON b.id = o.buyer_id
    JOIN user_accounts e ON e.id = o.expert_id
   WHERE ${where}
   ORDER BY ${order} LIMIT ${BATCH}`;

export interface GigSweepResult { reminded: number; accepted: number; overdue: number }

/**
 * Gig order sweep, every 10 minutes:
 *  1. Delivered orders (milestone 'submitted', contract not disputed) 5+ days old that have
 *     had no reminder: the buyer is told (in-app + email) the order auto-accepts in 2 days.
 *  2. Delivered orders 7+ days old: accepted and released through
 *     ContractsService.autoAcceptAndRelease (system actor); both parties are told.
 *  3. Funded orders past due_at (milestone funded | revision_requested) not yet flagged:
 *     overdue_notified_at is set and the expert, buyer and admins are told. Nothing is
 *     cancelled automatically; the buyer may open a dispute from the contract.
 *
 * Like DisputeSweepService, each run takes a session-level pg_try_advisory_lock on one pooled
 * connection, so only one API instance sweeps at a time. Every step is also conditional
 * (reminder_sent_at / overdue_notified_at IS NULL, milestone still 'submitted' under the
 * contract lock), so an overlapping run could not notify or release twice.
 * GIG_SWEEP_ENABLED=false turns the timer off.
 */
@Injectable()
export class GigSweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(GigSweepService.name);
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly contracts: ContractsService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('GIG_SWEEP_ENABLED') !== 'false';
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => this.tick(), GIG_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
    this.logger.log(`Gig sweep scheduled every ${GIG_SWEEP_INTERVAL_MS / 60_000} min`);
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  private tick() {
    if (this.running) return;
    this.running = this.sweep()
      .catch((err) => this.logger.error(`Gig sweep failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => { this.running = null; });
  }

  /** One round. Returns the counts, or null when another instance holds the lock. Public for tests. */
  async sweep(): Promise<GigSweepResult | null> {
    const client = await this.db.connect();
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked', [GIG_SWEEP_LOCK_KEY]);
      if (!rows[0]?.locked) return null;
      try {
        // Accept first so an order past 7 days is never reminded as well.
        const accepted = await this.autoAccept(client);
        const reminded = await this.remind(client);
        const overdue = await this.flagOverdue(client);
        if (reminded || accepted || overdue) {
          this.logger.log(`Gig sweep: ${reminded} reminded, ${accepted} auto-accepted, ${overdue} flagged overdue`);
        }
        return { reminded, accepted, overdue };
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [GIG_SWEEP_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
  }

  // ─── Steps ────────────────────────────────────────────────────────────────

  private async remind(client: PoolClient): Promise<number> {
    const { rows } = await client.query<SweepOrder>(orderQuery(
      `o.status = 'delivered' AND m.status = 'submitted' AND c.status <> 'disputed'
       AND o.reminder_sent_at IS NULL AND o.delivered_at <= NOW() - make_interval(days => $1)
       AND o.delivered_at > NOW() - make_interval(days => $2)`,
      'o.delivered_at ASC'), [GIG_REMINDER_DAYS, GIG_AUTO_ACCEPT_DAYS]);
    const daysLeft = GIG_AUTO_ACCEPT_DAYS - GIG_REMINDER_DAYS;
    let done = 0;
    for (const o of rows) {
      try {
        const sent = await this.inTransaction(client, async () => {
          const { rows: marked } = await client.query(
            `UPDATE gig_orders SET reminder_sent_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND status = 'delivered' AND reminder_sent_at IS NULL RETURNING id`, [o.id]);
          if (!marked.length) return false;
          await this.notifications.send(o.buyer_id,
            `Your order "${o.service_title}" will be accepted automatically in ${daysLeft} days unless you review it`,
            orderLink(o.id), client);
          if (o.buyer_email) {
            await this.email.enqueue('gig-delivery-reminder', o.buyer_email, {
              firstName: o.buyer_first_name ?? '', serviceTitle: o.service_title, daysLeft, path: orderLink(o.id),
            }, { userId: o.buyer_id, client, dedupeKey: `gig-delivery-reminder:${o.id}:${Date.now()}` });
          }
          return true;
        });
        if (sent) done++;
      } catch (err) {
        this.logger.warn(`Reminder for order ${o.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return done;
  }

  private async autoAccept(client: PoolClient): Promise<number> {
    const { rows } = await client.query<SweepOrder>(orderQuery(
      `o.status = 'delivered' AND m.status = 'submitted' AND c.status <> 'disputed'
       AND o.delivered_at <= NOW() - make_interval(days => $1)`,
      'o.delivered_at ASC'), [GIG_AUTO_ACCEPT_DAYS]);
    let done = 0;
    for (const o of rows) {
      try {
        const reason = `the buyer did not review the delivery within ${GIG_AUTO_ACCEPT_DAYS} days`;
        if (!(await this.contracts.autoAcceptAndRelease(o.contract_id, o.milestone_id, reason))) continue;
        done++;
        await this.afterAutoAccept(o);
      } catch (err) {
        this.logger.warn(`Auto-accept of order ${o.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return done;
  }

  /** The release is committed; telling the parties must not undo it, so failures are only logged. */
  private async afterAutoAccept(o: SweepOrder) {
    const parties = [
      { id: o.buyer_id, email: o.buyer_email, first: o.buyer_first_name, audience: 'buyer' as const,
        text: `Your order "${o.service_title}" was accepted automatically and the payment released to the expert` },
      { id: o.expert_id, email: o.expert_email, first: o.expert_first_name, audience: 'expert' as const,
        text: `Your delivery for "${o.service_title}" was accepted automatically and your payment released` },
    ];
    for (const p of parties) {
      try {
        await this.notifications.send(p.id, p.text, orderLink(o.id));
        if (p.email) {
          await this.email.enqueue('gig-auto-accepted', p.email, {
            firstName: p.first ?? '', serviceTitle: o.service_title, audience: p.audience, path: orderLink(o.id),
          }, { userId: p.id, dedupeKey: `gig-auto-accepted:${o.id}:${p.audience}` });
        }
      } catch (err) {
        this.logger.warn(`Auto-accept notice to ${p.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  private async flagOverdue(client: PoolClient): Promise<number> {
    const { rows } = await client.query<SweepOrder>(orderQuery(
      `o.status IN ('in_progress', 'revision_requested') AND m.status IN ('funded', 'revision_requested')
       AND o.due_at IS NOT NULL AND o.due_at < NOW() AND o.overdue_notified_at IS NULL`,
      'o.due_at ASC'));
    if (!rows.length) return 0;
    const { rows: admins } = await client.query<{ id: string }>(
      `SELECT id FROM user_accounts WHERE role = 'Admin' AND account_status = 'active'`);
    let done = 0;
    for (const o of rows) {
      try {
        const flagged = await this.inTransaction(client, async () => {
          const { rows: marked } = await client.query(
            `UPDATE gig_orders SET overdue_notified_at = NOW(), updated_at = NOW()
              WHERE id = $1 AND overdue_notified_at IS NULL RETURNING id`, [o.id]);
          if (!marked.length) return false;
          const link = orderLink(o.id);
          await this.notifications.send(o.expert_id,
            `Your order "${o.service_title}" is overdue; please deliver as soon as you can`, link, client);
          await this.notifications.send(o.buyer_id,
            `Your order "${o.service_title}" is overdue. You can open a dispute from the contract if it is not delivered`,
            link, client);
          for (const a of admins) {
            await this.notifications.send(a.id, `Gig order ${o.id} ("${o.service_title}") is overdue`, link, client);
          }
          return true;
        });
        if (flagged) done++;
      } catch (err) {
        this.logger.warn(`Overdue flag for order ${o.id} failed: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    return done;
  }

  /** BEGIN / COMMIT on the sweep's own connection (the advisory lock is session-level, so it is unaffected). */
  private async inTransaction<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');
    try {
      const out = await fn();
      await client.query('COMMIT');
      return out;
    } catch (err) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw err;
    }
  }
}
