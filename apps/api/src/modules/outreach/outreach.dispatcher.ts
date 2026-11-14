import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { EmailService } from '../email/email.service';
import { unsubscribeToken } from './outreach-templates';
import { OUTREACH_CONFIG, type OutreachConfig } from './outreach.service';

const BATCH = 200;

/**
 * Releases due outreach messages (send_after ≤ now) into email_outbox, in the same
 * transaction that marks them released, so each is enqueued exactly once. Rows are
 * claimed with SKIP LOCKED, so every API replica can run it. Suppression is checked
 * again here: someone may unsubscribe between queueing and sending.
 */
@Injectable()
export class OutreachDispatcher implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(OutreachDispatcher.name);
  private readonly enabled: boolean;
  private readonly intervalMs: number;
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly email: EmailService,
    @Inject(OUTREACH_CONFIG) private readonly config: OutreachConfig,
    settings: ConfigService,
  ) {
    this.enabled = settings.get<string>('OUTREACH_DISPATCH_ENABLED') !== 'false';
    this.intervalMs = Number(settings.get('OUTREACH_DISPATCH_MS') ?? 15_000);
  }

  onApplicationBootstrap() {
    if (!this.enabled) return;
    this.timer = setInterval(() => { void this.tick(); }, this.intervalMs);
  }

  onApplicationShutdown() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(): Promise<{ released: number; skipped: number }> {
    if (this.running) return { released: 0, skipped: 0 };
    this.running = true;
    try {
      return await this.dispatch();
    } catch (err) {
      this.logger.error(`Outreach dispatch failed: ${err instanceof Error ? err.message : err}`);
      return { released: 0, skipped: 0 };
    } finally {
      this.running = false;
    }
  }

  async dispatch(): Promise<{ released: number; skipped: number }> {
    return withTransaction(this.db, async (c) => {
      const { rows } = await c.query<{
        id: string; tenant_id: string; to_email: string; subject: string; body: string; company: string; suppressed: boolean;
      }>(
        `SELECT m.id, m.tenant_id, m.to_email, m.subject, m.body, t.name AS company,
                EXISTS (SELECT 1 FROM outreach_suppressions s WHERE s.tenant_id = m.tenant_id AND s.email = LOWER(m.to_email)) AS suppressed
           FROM outreach_messages m
           JOIN outreach_campaigns c ON c.id = m.campaign_id AND c.status = 'queued'
           JOIN tenants t ON t.id = m.tenant_id
          WHERE m.status = 'queued' AND m.send_after <= NOW()
          ORDER BY m.send_after
          LIMIT ${BATCH}
          FOR UPDATE OF m SKIP LOCKED`,
      );
      let released = 0;
      let skipped = 0;
      for (const m of rows) {
        if (m.suppressed) {
          await c.query(`UPDATE outreach_messages SET status = 'skipped', skip_reason = 'unsubscribed' WHERE id = $1`, [m.id]);
          skipped++;
          continue;
        }
        const token = unsubscribeToken(this.config.unsubscribeSecret, m.tenant_id, m.to_email);
        const outboxId = await this.email.enqueue('outreach', m.to_email, {
          subject: m.subject, body: m.body, companyName: m.company,
          unsubscribePath: `/api/v1/outreach/unsubscribe?token=${encodeURIComponent(token)}`,
        }, { client: c, dedupeKey: `outreach:${m.id}` });
        await c.query(
          `UPDATE outreach_messages SET status = 'released', outbox_id = $2, released_at = NOW() WHERE id = $1`, [m.id, outboxId],
        );
        released++;
      }
      // A queued campaign with nothing left to release is complete.
      await c.query(
        `UPDATE outreach_campaigns c SET status = 'completed', completed_at = NOW(), updated_at = NOW()
          WHERE c.status = 'queued'
            AND NOT EXISTS (SELECT 1 FROM outreach_messages m WHERE m.campaign_id = c.id AND m.status = 'queued')`,
      );
      if (released || skipped) this.logger.log(`Outreach: released ${released}, skipped ${skipped}`);
      return { released, skipped };
    });
  }
}
