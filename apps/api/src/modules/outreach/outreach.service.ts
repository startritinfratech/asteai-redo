import {
  BadRequestException, ConflictException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type {
  CampaignDelivery, MessageDelivery, OutreachEmailCampaign, OutreachRecipient, User,
} from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { cleanProspects } from '../talent-pools/board';
import { TalentPoolsService } from '../talent-pools/talent-pools.service';
import { firstNameOf, readUnsubscribeToken, renderTemplate, sendAfter, unknownVariables } from './outreach-templates';

export const OUTREACH_CONFIG = 'OUTREACH_CONFIG';
export interface OutreachConfig {
  /** Messages a company may queue per rolling 24 hours. */
  dailyLimit: number;
  unsubscribeSecret: string;
}

export const MAX_RECIPIENTS = 5000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface CampaignRow {
  id: string; tenant_id: string; created_by: string | null; name: string; subject_template: string; body_template: string;
  requisition_id: string | null; pool_id: string | null; status: OutreachEmailCampaign['status']; rate_per_minute: number;
  recipients: OutreachRecipient[]; queued_at: Date | null; completed_at: Date | null; created_at: Date;
}

export interface CreateCampaignInput {
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  ratePerMinute?: number;
  requisitionId?: string;
  poolId?: string;
  poolColumns?: string[];
  recipients?: { email: string; fullName?: string }[];
}

const iso = (d: Date | null) => (d ? new Date(d).toISOString() : null);

/** The delivery counts, with sent/failed taken from each message's email_outbox row. */
export const DELIVERY_SQL = `
  SELECT COUNT(*)::int AS total,
         COUNT(*) FILTER (WHERE m.status = 'queued')::int AS queued,
         COUNT(*) FILTER (WHERE m.status = 'released' AND (o.status IS NULL OR o.status IN ('pending', 'sending')))::int AS sending,
         COUNT(*) FILTER (WHERE m.status = 'released' AND o.status = 'sent')::int AS sent,
         COUNT(*) FILTER (WHERE m.status = 'released' AND o.status = 'failed')::int AS failed,
         COUNT(*) FILTER (WHERE m.status = 'skipped')::int AS skipped,
         COUNT(*) FILTER (WHERE m.status = 'cancelled')::int AS cancelled
    FROM outreach_messages m LEFT JOIN email_outbox o ON o.id = m.outbox_id
   WHERE m.campaign_id = $1`;

function tenantOf(user: Pick<User, 'tenantId'>): string {
  if (!user.tenantId) throw new ForbiddenException('Outreach campaigns belong to a company account');
  return user.tenantId;
}

/**
 * Bulk candidate outreach. A campaign is a draft (template + recipients) until queued;
 * queuing renders one message per recipient and spaces them `ratePerMinute` apart.
 * OutreachDispatcher hands due messages to email_outbox; EmailWorker sends them.
 */
@Injectable()
export class OutreachService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly pools: TalentPoolsService,
    @Inject(OUTREACH_CONFIG) private readonly config: OutreachConfig,
  ) {}

  private map(r: CampaignRow, delivery: CampaignDelivery | null): OutreachEmailCampaign {
    return {
      id: r.id, name: r.name, subjectTemplate: r.subject_template, bodyTemplate: r.body_template,
      requisitionId: r.requisition_id, poolId: r.pool_id, status: r.status, ratePerMinute: r.rate_per_minute,
      recipientCount: delivery?.total ?? (r.recipients ?? []).length, delivery,
      queuedAt: iso(r.queued_at), completedAt: iso(r.completed_at), createdAt: new Date(r.created_at).toISOString(),
    };
  }

  async create(user: User, input: CreateCampaignInput): Promise<OutreachEmailCampaign> {
    const tenantId = tenantOf(user);
    const unknown = [...unknownVariables(input.subjectTemplate), ...unknownVariables(input.bodyTemplate)];
    if (unknown.length) throw new BadRequestException(`Unknown template variable(s): ${[...new Set(unknown)].map((v) => `{{${v}}}`).join(', ')}`);
    if (!!input.poolId === !!input.recipients?.length) throw new BadRequestException('Give either a poolId or a recipients list');

    if (input.requisitionId) {
      const { rows } = await this.db.query(`SELECT 1 FROM requisitions WHERE id = $1 AND tenant_id = $2`, [input.requisitionId, tenantId]);
      if (!rows.length) throw new NotFoundException('Requisition not found');
    }
    const raw = input.poolId ? await this.pools.recipients(this.db, user, input.poolId, input.poolColumns) : input.recipients ?? [];
    if (raw.length > MAX_RECIPIENTS) throw new BadRequestException(`A campaign can reach at most ${MAX_RECIPIENTS} people`);
    const { valid, invalid } = cleanProspects(raw, MAX_RECIPIENTS);
    if (!valid.length) throw new BadRequestException(invalid.length ? 'None of the addresses are valid' : 'No recipients');

    const { rows } = await this.db.query<CampaignRow>(
      `INSERT INTO outreach_campaigns
         (tenant_id, created_by, name, subject_template, body_template, requisition_id, pool_id, rate_per_minute, recipients)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb) RETURNING *`,
      [tenantId, user.id, input.name.trim(), input.subjectTemplate.trim(), input.bodyTemplate.trim(), input.requisitionId ?? null,
        input.poolId ?? null, input.ratePerMinute ?? 60, JSON.stringify(valid.map((v) => ({ email: v.email, fullName: v.fullName })))],
    );
    return this.map(rows[0], null);
  }

  private async load(db: Pick<PoolClient, 'query'>, user: User, id: string, forUpdate = false): Promise<CampaignRow> {
    if (!UUID.test(id)) throw new NotFoundException('Campaign not found');
    const { rows } = await db.query<CampaignRow>(
      `SELECT * FROM outreach_campaigns WHERE id = $1 AND tenant_id = $2 ${forUpdate ? 'FOR UPDATE' : ''}`, [id, tenantOf(user)],
    );
    if (!rows.length) throw new NotFoundException('Campaign not found');
    return rows[0];
  }

  /**
   * Renders and schedules every message. Refused (429) if it would take the company past
   * its daily limit. Suppressed (unsubscribed) addresses are recorded as skipped.
   */
  async queue(user: User, id: string): Promise<OutreachEmailCampaign> {
    return withTransaction(this.db, async (c) => {
      const campaign = await this.load(c, user, id, true);
      if (campaign.status !== 'draft') throw new ConflictException(`This campaign is already ${campaign.status}`);
      const recipients = campaign.recipients ?? [];

      // Serialize queueing per company so two campaigns can't both squeeze under the cap.
      await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`outreach:${campaign.tenant_id}`]);
      const { rows: used } = await c.query<{ n: number }>(
        `SELECT COUNT(*)::int AS n FROM outreach_messages
          WHERE tenant_id = $1 AND status <> 'skipped' AND created_at > NOW() - INTERVAL '24 hours'`,
        [campaign.tenant_id],
      );
      const remaining = this.config.dailyLimit - (used[0]?.n ?? 0);
      if (recipients.length > remaining) {
        throw new HttpException(
          `This would send ${recipients.length} emails; your company can queue ${Math.max(0, remaining)} more in the next 24 hours.`,
          HttpStatus.TOO_MANY_REQUESTS,
        );
      }

      const { rows: ctx } = await c.query<{ company: string; job_title: string | null; sender: string }>(
        `SELECT t.name AS company, r.title AS job_title, CONCAT_WS(' ', u.first_name, u.last_name) AS sender
           FROM tenants t
           LEFT JOIN requisitions r ON r.id = $2
           LEFT JOIN user_accounts u ON u.id = $3
          WHERE t.id = $1`,
        [campaign.tenant_id, campaign.requisition_id, campaign.created_by],
      );
      const { rows: suppressed } = await c.query<{ email: string }>(
        `SELECT email FROM outreach_suppressions WHERE tenant_id = $1 AND email = ANY($2::text[])`,
        [campaign.tenant_id, recipients.map((r) => r.email)],
      );
      const blocked = new Set(suppressed.map((s) => s.email));
      const shared = { companyName: ctx[0]?.company ?? '', jobTitle: ctx[0]?.job_title ?? '', senderName: ctx[0]?.sender ?? '' };

      const now = new Date();
      let slot = 0;
      const messages = recipients.map((r) => {
        const vars = { ...shared, fullName: r.fullName, firstName: firstNameOf(r.fullName) };
        const skip = blocked.has(r.email);
        return {
          to_email: r.email, to_name: r.fullName,
          subject: renderTemplate(campaign.subject_template, vars).slice(0, 250),
          body: renderTemplate(campaign.body_template, vars),
          status: skip ? 'skipped' : 'queued',
          skip_reason: skip ? 'unsubscribed' : null,
          send_after: sendAfter(now, skip ? 0 : slot++, campaign.rate_per_minute).toISOString(),
        };
      });
      await c.query(
        `INSERT INTO outreach_messages (campaign_id, tenant_id, to_email, to_name, subject, body, status, skip_reason, send_after)
         SELECT $1, $2, v.to_email, v.to_name, v.subject, v.body, v.status, v.skip_reason, v.send_after
           FROM jsonb_to_recordset($3::jsonb) AS v(to_email text, to_name text, subject text, body text, status text, skip_reason text, send_after timestamptz)
         ON CONFLICT DO NOTHING`,
        [campaign.id, campaign.tenant_id, JSON.stringify(messages)],
      );
      const { rows } = await c.query<CampaignRow>(
        `UPDATE outreach_campaigns SET status = 'queued', queued_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [campaign.id],
      );
      return this.map(rows[0], await this.delivery(c, campaign.id));
    });
  }

  /** Stops what hasn't been released yet; released messages are already with the mailer. */
  async cancel(user: User, id: string): Promise<OutreachEmailCampaign> {
    return withTransaction(this.db, async (c) => {
      const campaign = await this.load(c, user, id, true);
      if (campaign.status === 'completed' || campaign.status === 'cancelled') {
        throw new ConflictException(`This campaign is already ${campaign.status}`);
      }
      await c.query(`UPDATE outreach_messages SET status = 'cancelled' WHERE campaign_id = $1 AND status = 'queued'`, [id]);
      const { rows } = await c.query<CampaignRow>(
        `UPDATE outreach_campaigns SET status = 'cancelled', completed_at = NOW(), updated_at = NOW() WHERE id = $1 RETURNING *`, [id],
      );
      return this.map(rows[0], await this.delivery(c, id));
    });
  }

  async list(user: User): Promise<OutreachEmailCampaign[]> {
    const { rows } = await this.db.query<CampaignRow>(
      `SELECT * FROM outreach_campaigns WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 100`, [tenantOf(user)],
    );
    return Promise.all(rows.map(async (r) => this.map(r, r.status === 'draft' ? null : await this.delivery(this.db, r.id))));
  }

  async get(user: User, id: string): Promise<OutreachEmailCampaign> {
    const r = await this.load(this.db, user, id);
    return this.map(r, r.status === 'draft' ? null : await this.delivery(this.db, id));
  }

  /** Per-recipient delivery status for a campaign. */
  async messages(user: User, id: string, status?: MessageDelivery) {
    await this.load(this.db, user, id);
    const { rows } = await this.db.query<{
      id: string; to_email: string; to_name: string; status: string; outbox_status: string | null; send_after: Date;
      released_at: Date | null; sent_at: Date | null; skip_reason: string | null; last_error: string | null;
    }>(
      `SELECT m.id, m.to_email, m.to_name, m.status, o.status AS outbox_status, m.send_after, m.released_at, o.sent_at,
              m.skip_reason, o.last_error
         FROM outreach_messages m LEFT JOIN email_outbox o ON o.id = m.outbox_id
        WHERE m.campaign_id = $1 ORDER BY m.send_after LIMIT 1000`,
      [id],
    );
    const list = rows.map((r) => ({
      id: r.id, email: r.to_email, name: r.to_name, delivery: deliveryOf(r.status, r.outbox_status),
      scheduledFor: new Date(r.send_after).toISOString(), sentAt: iso(r.sent_at), skipReason: r.skip_reason,
      error: r.outbox_status === 'failed' ? (r.last_error ?? 'delivery failed').slice(0, 200) : null,
    }));
    return status ? list.filter((m) => m.delivery === status) : list;
  }

  private async delivery(db: Pick<PoolClient, 'query'>, id: string): Promise<CampaignDelivery> {
    const { rows } = await db.query<CampaignDelivery>(DELIVERY_SQL, [id]);
    return rows[0] ?? { total: 0, queued: 0, sending: 0, sent: 0, failed: 0, skipped: 0, cancelled: 0 };
  }

  /** The link in every outreach email. Idempotent; also cancels anything still queued to that address. */
  async unsubscribe(token: string): Promise<boolean> {
    const who = readUnsubscribeToken(this.config.unsubscribeSecret, token);
    if (!who) return false;
    await withTransaction(this.db, async (c) => {
      await c.query(
        `INSERT INTO outreach_suppressions (tenant_id, email) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [who.tenantId, who.email],
      );
      await c.query(
        `UPDATE outreach_messages SET status = 'skipped', skip_reason = 'unsubscribed'
          WHERE tenant_id = $1 AND LOWER(to_email) = $2 AND status = 'queued'`,
        [who.tenantId, who.email],
      );
    });
    return true;
  }
}

/** One recipient's delivery state, combining the message and its outbox row. */
export function deliveryOf(messageStatus: string, outboxStatus: string | null): MessageDelivery {
  if (messageStatus === 'skipped') return 'skipped';
  if (messageStatus === 'cancelled') return 'cancelled';
  if (messageStatus === 'queued') return 'queued';
  if (outboxStatus === 'sent') return 'sent';
  if (outboxStatus === 'failed') return 'failed';
  return 'sending';
}
