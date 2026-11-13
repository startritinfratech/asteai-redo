import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { Pagination } from '../../common/utils/pagination';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { Invoice } from '../ledger/billing-types';
import { renderInvoicePdf, type InvoiceIssuer } from './invoice-pdf';
import { InvoiceRow, mapInvoice } from './invoice.mapper';

const INVOICES_LINK = '/platform/invoices';

/** 'INV-2026-000123'. */
export const invoiceNumber = (year: number, seq: number) => `INV-${year}-${String(seq).padStart(6, '0')}`;

interface CapturedPaymentRow {
  id: string;
  status: string;
  amount: string | number;
  currency: string;
  provider: string | null;
  provider_payment_id: string | null;
  contract_id: string;
  milestone_id: string;
  buyer_id: string;
  expert_id: string;
  milestone_seq: number;
  milestone_title: string;
  project_title: string | null;
  buyer_name: string | null;
  buyer_first_name: string | null;
  buyer_email: string | null;
  expert_name: string | null;
  issue_year: number;
}

/**
 * Invoices: one per captured escrow payment, issued to the buyer. Numbers are sequential
 * per calendar year (IST) from invoice_counters, so they have no gaps: the counter only
 * moves in the transaction that inserts the invoice. The PDF is rendered on demand.
 *
 * Platform fees are not charged yet: platform_fee is always 0 and no 'Fee' ledger row is
 * written. Tax (gstin / tax_amount) stays empty until GST invoicing is decided.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly config: ConfigService,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  /**
   * Issues the invoice for a captured escrow payment, once. Call it after the capture,
   * either inside the capturing transaction (pass its `client`) or after it commits.
   * A second call for the same payment returns the existing invoice and sends nothing.
   * The buyer's notification and email are written in the same transaction.
   */
  async createForCapturedPayment(escrowPaymentId: string, client?: PoolClient): Promise<Invoice> {
    const run = (c: PoolClient) => this.issue(c, escrowPaymentId);
    return client ? run(client) : withTransaction(this.db, run);
  }

  private async issue(client: PoolClient, escrowPaymentId: string): Promise<Invoice> {
    // Locks the payment row: concurrent calls for one payment queue here.
    const { rows: found } = await client.query<CapturedPaymentRow>(
      `SELECT ep.id, ep.status, ep.amount, ep.currency, ep.provider, ep.provider_payment_id,
              ep.contract_id, ep.milestone_id, c.buyer_id, c.expert_id,
              cm.seq AS milestone_seq, cm.title AS milestone_title, COALESCE(pj.title, c.title) AS project_title,
              TRIM(CONCAT_WS(' ', b.first_name, b.last_name)) AS buyer_name, b.first_name AS buyer_first_name,
              b.email AS buyer_email, TRIM(CONCAT_WS(' ', e.first_name, e.last_name)) AS expert_name,
              EXTRACT(YEAR FROM (NOW() AT TIME ZONE 'Asia/Kolkata'))::int AS issue_year
         FROM escrow_payments ep
         JOIN contracts c ON c.id = ep.contract_id
         JOIN contract_milestones cm ON cm.id = ep.milestone_id
         LEFT JOIN projects pj ON pj.id = c.project_id
         JOIN user_accounts b ON b.id = c.buyer_id
         JOIN user_accounts e ON e.id = c.expert_id
        WHERE ep.id = $1
        FOR UPDATE OF ep`,
      [escrowPaymentId],
    );
    const p = found[0];
    if (!p) throw new NotFoundException('Escrow payment not found');

    const { rows: existing } = await client.query<InvoiceRow>(
      `SELECT * FROM invoices WHERE escrow_payment_id = $1`,
      [escrowPaymentId],
    );
    if (existing[0]) return mapInvoice(existing[0]);
    if (p.status !== 'captured') throw new ConflictException(`Escrow payment ${escrowPaymentId} is '${p.status}', not captured`);

    const { rows: counter } = await client.query<{ last: number }>(
      `INSERT INTO invoice_counters (year, last) VALUES ($1, 1)
       ON CONFLICT (year) DO UPDATE SET last = invoice_counters.last + 1
       RETURNING last`,
      [p.issue_year],
    );
    const id = invoiceNumber(p.issue_year, Number(counter[0].last));
    const currency = p.currency.trim();
    const { rows } = await client.query<InvoiceRow>(
      `INSERT INTO invoices (id, contract_id, milestone_id, escrow_payment_id, buyer_id, expert_id, amount, platform_fee,
                             currency, provider, provider_payment_id, buyer_name, buyer_email, expert_name,
                             project_title, milestone_seq, milestone_title)
       VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12, $13, $14, $15, $16)
       RETURNING *`,
      [
        id, p.contract_id, p.milestone_id, p.id, p.buyer_id, p.expert_id, p.amount, currency, p.provider,
        p.provider_payment_id, p.buyer_name ?? '', p.buyer_email ?? '', p.expert_name ?? '', p.project_title ?? '',
        p.milestone_seq, p.milestone_title,
      ],
    );
    const invoice = mapInvoice(rows[0]);

    const amount = new Intl.NumberFormat('en-IN', { style: 'currency', currency }).format(invoice.amount);
    await this.notifications.send(p.buyer_id, `Invoice ${id} for ${amount} is ready`, INVOICES_LINK, client);
    if (p.buyer_email) {
      await this.email.enqueue('invoice-issued', p.buyer_email, {
        firstName: p.buyer_first_name ?? '', invoiceId: id, amount,
        projectTitle: invoice.projectTitle, milestoneTitle: invoice.milestoneTitle, path: INVOICES_LINK,
      }, { userId: p.buyer_id, dedupeKey: `invoice-issued:${id}`, client });
    }
    return invoice;
  }

  /** Admins see every invoice; anyone else the invoices where they are the buyer or the expert. */
  async list(user: User, page: Pagination): Promise<Invoice[]> {
    const admin = user.role === 'Admin';
    const { rows } = await this.db.query<InvoiceRow>(
      admin
        ? `SELECT * FROM invoices ORDER BY issued_at DESC, id DESC LIMIT $1 OFFSET $2`
        : `SELECT * FROM invoices WHERE buyer_id = $3 OR expert_id = $3 ORDER BY issued_at DESC, id DESC LIMIT $1 OFFSET $2`,
      admin ? [page.pageSize, page.offset] : [page.pageSize, page.offset, user.id],
    );
    return rows.map(mapInvoice);
  }

  /** 404 for an invoice that does not exist or that the user is not a party to. */
  async findOne(user: User, id: string): Promise<Invoice> {
    const { rows } = await this.db.query<InvoiceRow>(`SELECT * FROM invoices WHERE id = $1`, [id]);
    const row = rows[0];
    if (!row || (user.role !== 'Admin' && row.buyer_id !== user.id && row.expert_id !== user.id)) {
      throw new NotFoundException('Invoice not found');
    }
    return mapInvoice(row);
  }

  async pdf(user: User, id: string): Promise<{ invoice: Invoice; pdf: Buffer }> {
    const invoice = await this.findOne(user, id);
    return { invoice, pdf: await renderInvoicePdf(invoice, this.issuer()) };
  }

  /** INVOICE_ISSUER_NAME (default 'AsteAI'), INVOICE_ISSUER_ADDRESS, INVOICE_ISSUER_GSTIN. */
  private issuer(): InvoiceIssuer {
    return {
      name: this.config.get<string>('INVOICE_ISSUER_NAME') || 'AsteAI',
      address: this.config.get<string>('INVOICE_ISSUER_ADDRESS') || undefined,
      gstin: this.config.get<string>('INVOICE_ISSUER_GSTIN') || undefined,
    };
  }
}
