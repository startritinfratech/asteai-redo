import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomBytes } from 'crypto';
import { Pool } from 'pg';
import type { CareerRole, FormReceipt, Lead, LeadStatus, NewsletterResult } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { BotCheckService } from '../../common/security/bot-check.service';
import type { Pagination } from '../../common/utils/pagination';
import { EmailService } from '../email/email.service';
import { sha256Hex } from '../auth/totp';
import type { CareerApplicationDto, ContactDto, LeadDto, NewsletterDto } from './dto/marketing.dto';

/** Fallback inbox for internal notifications when SALES_INBOX / SUPPORT_INBOX are unset. */
export const DEFAULT_INBOX = 'supportasteai@startrit.com';
export const NEWSLETTER_CONFIRM_TTL_MS = 7 * 24 * 60 * 60_000;

const RECEIVED: FormReceipt = { received: true };

/** Client context the controller passes in (for bot checks and the audit columns). */
export interface RequestContext {
  ip: string | null;
  userAgent?: string | null;
}

interface LeadRow {
  id: string; track: Lead['track']; role_title: string; skills: string | null; work_mode: Lead['workMode'];
  timeline: Lead['timeline']; company: string; contact_name: string; email: string; phone: string;
  status: LeadStatus; created_at: Date;
}

const mapLead = (r: LeadRow): Lead => ({
  id: r.id, track: r.track, roleTitle: r.role_title, skills: r.skills, workMode: r.work_mode, timeline: r.timeline,
  company: r.company, contactName: r.contact_name, email: r.email, phone: r.phone, status: r.status,
  createdAt: r.created_at.toISOString(),
});

/**
 * Public website forms. Each accepted submission is stored and its emails (internal
 * notification + acknowledgement to the sender) are queued in the same transaction.
 * A honeypot hit answers exactly like success but stores and sends nothing.
 */
@Injectable()
export class MarketingService {
  private readonly salesInbox: string;
  private readonly supportInbox: string;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly email: EmailService,
    private readonly bots: BotCheckService,
    config: ConfigService,
  ) {
    this.supportInbox = config.get<string>('SUPPORT_INBOX') || DEFAULT_INBOX;
    this.salesInbox = config.get<string>('SALES_INBOX') || this.supportInbox;
  }

  async submitLead(dto: LeadDto, ctx: RequestContext): Promise<FormReceipt> {
    if ((await this.bots.check(dto, ctx.ip)) === 'drop') return RECEIVED;
    await withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO leads (track, role_title, skills, work_mode, timeline, company, contact_name, email, phone, utm, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id`,
        [dto.track, dto.roleTitle, dto.skills || null, dto.workMode, dto.timeline, dto.company, dto.contactName,
          dto.email, dto.phone, JSON.stringify(dto.utm ?? {}), ctx.ip, ctx.userAgent?.slice(0, 400) ?? null],
      );
      const leadId = rows[0].id;
      await this.email.enqueue('lead-received', this.salesInbox, {
        leadId, track: dto.track, roleTitle: dto.roleTitle, skills: dto.skills || null, workMode: dto.workMode,
        timeline: dto.timeline, company: dto.company, contactName: dto.contactName, email: dto.email, phone: dto.phone,
      }, { client });
      await this.email.enqueue('lead-ack', dto.email, { contactName: dto.contactName, roleTitle: dto.roleTitle }, { client });
    });
    return RECEIVED;
  }

  async submitContact(dto: ContactDto, ctx: RequestContext): Promise<FormReceipt> {
    if ((await this.bots.check(dto, ctx.ip)) === 'drop') return RECEIVED;
    const intent = dto.intent ?? 'contact';
    await withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO contact_messages (name, email, subject, message, intent, ip) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [dto.name, dto.email, dto.subject, dto.message, intent, ctx.ip],
      );
      await this.email.enqueue('contact-received', this.supportInbox, {
        messageId: rows[0].id, intent, name: dto.name, email: dto.email, subject: dto.subject, message: dto.message,
      }, { client });
      await this.email.enqueue('contact-ack', dto.email, { name: dto.name, intent }, { client });
    });
    return RECEIVED;
  }

  /**
   * Double opt-in. Always answers `pending`, whatever the address's state, so the endpoint
   * can't be used to test who is subscribed. Only pending / unsubscribed addresses get a
   * (new) confirmation email; a subscribed one gets nothing.
   */
  async subscribe(dto: NewsletterDto, ctx: RequestContext): Promise<NewsletterResult> {
    const result: NewsletterResult = { status: 'pending' };
    if ((await this.bots.check(dto, ctx.ip)) === 'drop') return result;

    const confirmToken = randomBytes(32).toString('base64url');
    const unsubscribeToken = randomBytes(32).toString('base64url');
    const expires = new Date(Date.now() + NEWSLETTER_CONFIRM_TTL_MS);

    await withTransaction(this.db, async (client) => {
      // A new row, or a pending / unsubscribed one starting over. A subscribed row is left alone
      // (the WHERE on the conflict update makes RETURNING empty for it).
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO newsletter_subscribers
           (email, email_canonical, status, source, confirm_token_hash, confirm_expires_at, unsubscribe_token_hash, ip)
         VALUES ($1::text, LOWER($1::text), 'pending', $2, $3, $4, $5, $6)
         ON CONFLICT (email_canonical) DO UPDATE
           SET status = 'pending', confirm_token_hash = EXCLUDED.confirm_token_hash,
               confirm_expires_at = EXCLUDED.confirm_expires_at,
               unsubscribe_token_hash = EXCLUDED.unsubscribe_token_hash,
               source = COALESCE(EXCLUDED.source, newsletter_subscribers.source), updated_at = NOW()
           WHERE newsletter_subscribers.status <> 'subscribed'
         RETURNING id`,
        [dto.email, dto.source ?? null, sha256Hex(confirmToken), expires, sha256Hex(unsubscribeToken), ctx.ip],
      );
      if (!rows.length) return;
      await this.email.enqueue('newsletter-confirm', dto.email, {
        path: `/newsletter/confirm?token=${confirmToken}`,
        unsubscribePath: `/unsubscribe?token=${unsubscribeToken}`,
      }, { client });
    });
    return result;
  }

  async confirmSubscription(token: string): Promise<{ status: 'subscribed' }> {
    const { rowCount } = await this.db.query(
      `UPDATE newsletter_subscribers
          SET status = 'subscribed', confirmed_at = NOW(), confirm_token_hash = NULL, updated_at = NOW()
        WHERE confirm_token_hash = $1 AND status = 'pending' AND confirm_expires_at > NOW()`,
      [sha256Hex(token)],
    );
    if (!rowCount) throw new BadRequestException('This confirmation link is invalid or has expired.');
    return { status: 'subscribed' };
  }

  /** Idempotent: a valid token on an already-unsubscribed row still answers success. */
  async unsubscribe(token: string): Promise<{ status: 'unsubscribed' }> {
    const { rowCount } = await this.db.query(
      `UPDATE newsletter_subscribers
          SET status = 'unsubscribed', unsubscribed_at = COALESCE(unsubscribed_at, NOW()), confirm_token_hash = NULL, updated_at = NOW()
        WHERE unsubscribe_token_hash = $1`,
      [sha256Hex(token)],
    );
    if (!rowCount) throw new BadRequestException('This unsubscribe link is invalid.');
    return { status: 'unsubscribed' };
  }

  async careerRoles(): Promise<CareerRole[]> {
    const { rows } = await this.db.query<CareerRole>(
      `SELECT id, slug, title, team, location, type, skills, description
         FROM career_roles WHERE is_open ORDER BY sort, title`,
    );
    return rows;
  }

  async applyForRole(dto: CareerApplicationDto, ctx: RequestContext): Promise<FormReceipt> {
    if ((await this.bots.check(dto, ctx.ip)) === 'drop') return RECEIVED;
    await withTransaction(this.db, async (client) => {
      const role = await client.query<{ id: string; title: string }>(
        `SELECT id, title FROM career_roles WHERE slug = $1 AND is_open`, [dto.roleSlug],
      );
      if (!role.rows.length) throw new NotFoundException('This role is no longer open.');
      const { id: roleId, title } = role.rows[0];
      const { rows } = await client.query<{ id: string }>(
        `INSERT INTO career_applications (role_id, full_name, email, profile_url, message, ip)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
        [roleId, dto.fullName, dto.email, dto.profileUrl || null, dto.message || null, ctx.ip],
      );
      await this.email.enqueue('career-application', this.supportInbox, {
        applicationId: rows[0].id, roleTitle: title, fullName: dto.fullName, email: dto.email,
        profileUrl: dto.profileUrl || null, message: dto.message || null,
      }, { client });
      await this.email.enqueue('career-ack', dto.email, { fullName: dto.fullName, roleTitle: title }, { client });
    });
    return RECEIVED;
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async listLeads(status: LeadStatus | undefined, page: Pagination): Promise<{ items: Lead[]; total: number; page: number; pageSize: number }> {
    const { rows } = await this.db.query<LeadRow & { total: string }>(
      `SELECT id, track, role_title, skills, work_mode, timeline, company, contact_name, email, phone, status, created_at,
              COUNT(*) OVER () AS total
         FROM leads WHERE ($1::text IS NULL OR status = $1)
        ORDER BY created_at DESC, id DESC LIMIT $2 OFFSET $3`,
      [status ?? null, page.pageSize, page.offset],
    );
    return { items: rows.map(mapLead), total: Number(rows[0]?.total ?? 0), page: page.page, pageSize: page.pageSize };
  }

  async setLeadStatus(id: string, status: LeadStatus, adminId: string): Promise<Lead> {
    const { rows } = await this.db.query<LeadRow>(
      `UPDATE leads SET status = $2, owner_id = COALESCE(owner_id, $3), updated_at = NOW() WHERE id = $1
       RETURNING id, track, role_title, skills, work_mode, timeline, company, contact_name, email, phone, status, created_at`,
      [id, status, adminId],
    );
    if (!rows.length) throw new NotFoundException('Lead not found');
    return mapLead(rows[0]);
  }
}
