import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { EMAIL_TRANSPORT, EmailSendError, type EmailTransport } from './transports';

export const MAX_ATTEMPTS = 6;
const BATCH_SIZE = 10;
/** A row left in 'sending' this long belongs to a worker that died mid-send. */
const STUCK_AFTER_MINUTES = 10;

/** Minutes to wait after the n-th failed attempt: 1, 2, 4, 8, 16. */
export const backoffMinutes = (attempts: number) => Math.min(2 ** (attempts - 1), 60);

interface OutboxRow {
  id: string;
  to_address: string;
  subject: string;
  html: string;
  text: string;
  attempts: number;
}

/**
 * Sends queued email from email_outbox. Runs in every API process; rows are claimed
 * with FOR UPDATE SKIP LOCKED so replicas share the work without double-sending.
 * A failed send is retried with backoff up to MAX_ATTEMPTS, except permanent
 * failures (rejected address, unverified sender), which fail at once.
 *
 * Once a row is sent its html and text are blanked: bodies can hold single-use links
 * (password reset, email verification) that must not sit in the database in clear.
 * Subject, template and recipient stay as the record. Failed rows keep their body so
 * they can be retried.
 */
@Injectable()
export class EmailWorker implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(EmailWorker.name);
  private readonly enabled: boolean;
  private readonly pollMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running: Promise<void> | null = null;
  private stopping = false;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    @Inject(EMAIL_TRANSPORT) private readonly transport: EmailTransport,
    config: ConfigService,
  ) {
    this.enabled = config.get<string>('EMAIL_WORKER_ENABLED') !== 'false';
    this.pollMs = Number(config.get('EMAIL_POLL_MS') ?? 5000);
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.logger.log(`Email worker started (transport: ${this.transport.name}, every ${this.pollMs} ms)`);
    this.schedule(0);
  }

  async onApplicationShutdown() {
    this.stopping = true;
    if (this.timer) clearTimeout(this.timer);
    await this.running; // let an in-flight batch finish before the pool closes
  }

  private schedule(delay: number) {
    if (this.stopping) return;
    this.timer = setTimeout(() => {
      this.running = this.processBatch()
        .then(() => undefined)
        .catch((err) => this.logger.error(`Email batch failed: ${err instanceof Error ? err.message : err}`))
        .finally(() => {
          this.running = null;
          this.schedule(this.pollMs);
        });
    }, delay);
  }

  /** Claims and sends one batch. Returns how many emails were sent. Public for tests. */
  async processBatch(): Promise<number> {
    await this.db.query(
      `UPDATE email_outbox SET status = 'pending', claimed_at = NULL
        WHERE status = 'sending' AND claimed_at < NOW() - make_interval(mins => $1)`,
      [STUCK_AFTER_MINUTES],
    );

    const { rows } = await this.db.query<OutboxRow>(
      `UPDATE email_outbox SET status = 'sending', claimed_at = NOW(), attempts = attempts + 1
        WHERE id IN (
          SELECT id FROM email_outbox
           WHERE status = 'pending' AND next_attempt_at <= NOW()
           ORDER BY next_attempt_at
           LIMIT $1
           FOR UPDATE SKIP LOCKED)
        RETURNING id, to_address, subject, html, text, attempts`,
      [BATCH_SIZE],
    );

    let sent = 0;
    for (const row of rows) {
      try {
        const { id } = await this.transport.send({ to: row.to_address, subject: row.subject, html: row.html, text: row.text });
        await this.db.query(
          `UPDATE email_outbox
              SET status = 'sent', sent_at = NOW(), provider_id = $2, last_error = NULL, html = '', text = ''
            WHERE id = $1`,
          [row.id, id],
        );
        sent += 1;
      } catch (err) {
        await this.recordFailure(row, err);
      }
    }
    return sent;
  }

  private async recordFailure(row: OutboxRow, err: unknown) {
    const message = (err instanceof Error ? err.message : String(err)).slice(0, 1000);
    const permanent = err instanceof EmailSendError && err.permanent;
    if (permanent || row.attempts >= MAX_ATTEMPTS) {
      await this.db.query(`UPDATE email_outbox SET status = 'failed', last_error = $2 WHERE id = $1`, [row.id, message]);
      this.logger.error(`Email ${row.id} failed for good after ${row.attempts} attempt(s): ${message}`);
      return;
    }
    await this.db.query(
      `UPDATE email_outbox
          SET status = 'pending', claimed_at = NULL, last_error = $2,
              next_attempt_at = NOW() + make_interval(mins => $3)
        WHERE id = $1`,
      [row.id, message, backoffMinutes(row.attempts)],
    );
    this.logger.warn(`Email ${row.id} attempt ${row.attempts} failed, retrying in ${backoffMinutes(row.attempts)} min: ${message}`);
  }
}
