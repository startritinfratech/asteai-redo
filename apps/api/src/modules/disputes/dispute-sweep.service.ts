import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';

/** Every 10 minutes. */
export const DISPUTE_SWEEP_INTERVAL_MS = 10 * 60 * 1000;
/**
 * pg advisory lock key for the sweep (any fixed bigint, unique to this job). Only the
 * instance holding it sweeps; the others skip that round (AUDIT-31: scheduled jobs must not
 * double-run across API instances).
 */
export const DISPUTE_SWEEP_LOCK_KEY = 724_113_013;

/**
 * SLA sweep: an 'open' dispute whose respondent has not posted by respond_by (raised + 72h)
 * moves to 'under_review' (escalated_at set) and admins are notified.
 *
 * Runs in every API process on a timer, but each run first takes a session-level
 * pg_try_advisory_lock on one pooled connection: when another instance holds it, this run
 * does nothing. The UPDATE is also conditional (status = 'open'), so even an overlapping
 * run could not move a dispute twice. DISPUTE_SWEEP_ENABLED=false turns the timer off.
 */
@Injectable()
export class DisputeSweepService implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(DisputeSweepService.name);
  private readonly enabled: boolean;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<unknown> | null = null;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('DISPUTE_SWEEP_ENABLED') !== 'false';
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => this.tick(), DISPUTE_SWEEP_INTERVAL_MS);
    this.timer.unref?.();
    this.logger.log(`Dispute SLA sweep scheduled every ${DISPUTE_SWEEP_INTERVAL_MS / 60_000} min`);
  }

  async onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    await this.running;
  }

  private tick() {
    if (this.running) return; // the previous round is still going
    this.running = this.sweep()
      .catch((err) => this.logger.error(`Dispute sweep failed: ${err instanceof Error ? err.message : String(err)}`))
      .finally(() => { this.running = null; });
  }

  /**
   * One round. Returns how many disputes moved to review, or null when another instance
   * holds the lock (this one skipped). Public for tests.
   */
  async sweep(): Promise<number | null> {
    const client = await this.db.connect();
    let moved: { id: string; contract_id: string | null }[] = [];
    try {
      const { rows } = await client.query<{ locked: boolean }>(
        'SELECT pg_try_advisory_lock($1) AS locked', [DISPUTE_SWEEP_LOCK_KEY]);
      if (!rows[0]?.locked) return null;
      try {
        ({ rows: moved } = await client.query<{ id: string; contract_id: string | null }>(
          `UPDATE disputes d
              SET status = 'under_review', escalated_at = NOW(), updated_at = NOW()
            WHERE d.status = 'open' AND d.respond_by < NOW()
              AND NOT EXISTS (
                SELECT 1 FROM dispute_messages dm WHERE dm.dispute_id = d.id AND dm.author_id = d.against_user
              )
            RETURNING d.id, d.contract_id`,
        ));
        if (moved.length) {
          const { rows: admins } = await client.query<{ id: string }>(
            `SELECT id FROM user_accounts WHERE role = 'Admin' AND account_status = 'active'`,
          );
          for (const admin of admins) {
            for (const d of moved) {
              await this.notifications
                .send(admin.id, `Dispute ${d.id} got no response within 72 hours and needs review`, `/platform/disputes/${d.id}`)
                .catch((err) => this.logger.warn(`Notification to ${admin.id} failed: ${err instanceof Error ? err.message : err}`));
            }
          }
          this.logger.log(`Moved ${moved.length} unanswered dispute(s) to review`);
        }
      } finally {
        await client.query('SELECT pg_advisory_unlock($1)', [DISPUTE_SWEEP_LOCK_KEY]);
      }
    } finally {
      client.release();
    }
    return moved.length;
  }
}
