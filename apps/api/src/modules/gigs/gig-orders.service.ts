import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { GigOrder, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import type { Pagination } from '../../common/utils/pagination';
import { PUBLIC_EXPERT_SQL } from '../profiles/expert-search';
import { ContractsService } from '../contracts/contracts.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  CreateOrderDto, DeliverDto, ListOrdersQueryDto, OrderReviewDto, RevisionDto,
} from './dto/gig.dto';
import { DELIVERABLE, deliveryNote, isHttpsLink } from './gig-rules';
import { DeliveryRow, mapOrder, OrderRow } from './gig.mapper';

const ORDER_SQL = `SELECT o.*, s.title AS service_title, s.slug AS service_slug,
       sp.name AS package_name, sp.tier AS package_tier,
       CONCAT_WS(' ', b.first_name, b.last_name) AS buyer_name,
       CONCAT_WS(' ', e.first_name, e.last_name) AS expert_name,
       c.status AS contract_status, m.status AS milestone_status, m.revision_count AS revisions_used,
       EXISTS (SELECT 1 FROM reviews r WHERE r.gig_order_id = o.id) AS reviewed
  FROM gig_orders o
  JOIN services s ON s.id = o.service_id
  JOIN service_packages sp ON sp.id = o.package_id
  JOIN user_accounts b ON b.id = o.buyer_id
  JOIN user_accounts e ON e.id = o.expert_id
  LEFT JOIN contracts c ON c.id = o.contract_id
  LEFT JOIN contract_milestones m ON m.contract_id = c.id AND m.seq = 1`;

const orderLink = (id: string) => `/platform/orders/${encodeURIComponent(id)}`;

/**
 * Gig orders. An order is a contract (source 'gig') with one milestone, so every money and
 * state change goes through ContractsService: this class only checks the order-level rules
 * (who, which status, the revision limit), calls the contract method, and writes the order's
 * own rows (deliveries, reviews) inside the same transaction through the milestone hooks.
 * gig_orders.status itself follows the milestone via the trigger in migration 014.
 */
@Injectable()
export class GigOrdersService {
  private readonly logger = new Logger(GigOrdersService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly contracts: ContractsService,
    private readonly notifications: NotificationsService,
  ) {}

  // ─── Reads ────────────────────────────────────────────────────────────────

  async findAll(user: User, query: ListOrdersQueryDto, { pageSize, offset }: Pagination): Promise<GigOrder[]> {
    const where: string[] = [];
    const params: unknown[] = [];
    if (user.role !== 'Admin') {
      params.push(user.id);
      where.push(`(o.buyer_id = $${params.length} OR o.expert_id = $${params.length})`);
    }
    if (query.status) {
      params.push(query.status);
      where.push(`o.status = $${params.length}`);
    }
    params.push(pageSize, offset);
    const { rows } = await this.db.query<OrderRow>(
      `${ORDER_SQL} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
       ORDER BY o.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return rows.map((r) => mapOrder(r));
  }

  async findOne(id: string, user: User): Promise<GigOrder> {
    const row = await this.load(this.db, id);
    this.assertParty(row, user, true);
    const { rows: deliveries } = await this.db.query<DeliveryRow>(
      `SELECT id, note, links, created_at FROM gig_deliveries WHERE order_id = $1 ORDER BY created_at DESC`, [id],
    );
    return mapOrder(row, deliveries);
  }

  // ─── Order ────────────────────────────────────────────────────────────────

  /**
   * Order + contract + milestone in one transaction. The contract is 'active' at once: the
   * package terms are the agreement, and accepted_terms_at records the buyer accepting them.
   * The buyer then pays the milestone from the contract page (Razorpay -> escrow).
   */
  async create(dto: CreateOrderDto, user: User): Promise<GigOrder> {
    if (dto.acceptTerms !== true) throw new BadRequestException('You must accept the package terms to order');
    const requirements = dto.requirements.trim();
    if (requirements.length < 10) throw new BadRequestException('Describe what you need in at least 10 characters');

    const orderId = generateId('ORD');
    const contractId = generateId('CT');
    const expertId = await withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{
        package_id: string; service_id: string; service_title: string; expert_id: string; status: string;
        package_name: string; price: string; delivery_days: number; revisions: number; expert_listable: boolean | null;
      }>(
        `SELECT sp.id AS package_id, s.id AS service_id, s.title AS service_title, s.expert_id, s.status,
                sp.name AS package_name, sp.price, sp.delivery_days, sp.revisions,
                COALESCE((${PUBLIC_EXPERT_SQL}), FALSE) AS expert_listable
           FROM service_packages sp
           JOIN services s ON s.id = sp.service_id
           LEFT JOIN expert_profiles p ON p.user_id = s.expert_id
           LEFT JOIN user_accounts u ON u.id = s.expert_id
          WHERE sp.id = $1 AND sp.active
          FOR SHARE OF s, sp`,
        [dto.packageId],
      );
      const pkg = rows[0];
      if (!pkg || pkg.status !== 'published') throw new NotFoundException('This package is not available');
      if (pkg.expert_id === user.id) throw new ForbiddenException('You can not order your own service');
      if (!pkg.expert_listable) throw new ConflictException('This service is not available right now');

      const price = Number(pkg.price);
      await client.query(
        `INSERT INTO gig_orders (id, service_id, package_id, buyer_id, expert_id, requirements, price, delivery_days,
                                 revisions, accepted_terms_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, NOW())`,
        [orderId, pkg.service_id, pkg.package_id, user.id, pkg.expert_id, requirements, price, pkg.delivery_days, pkg.revisions],
      );
      await client.query(
        `INSERT INTO contracts (id, project_id, proposal_id, gig_order_id, title, tenant_id, buyer_id, expert_id,
                                engagement_model, payment_terms, currency, total_amount, status, source)
         VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, 'fixed', $7::jsonb, 'INR', $8, 'active', 'gig')`,
        [contractId, orderId, pkg.service_title.slice(0, 200), user.tenantId ?? null, user.id, pkg.expert_id,
          JSON.stringify({ totalAmount: price }), price],
      );
      await client.query(
        `INSERT INTO contract_milestones (contract_id, seq, title, amount) VALUES ($1, 1, $2, $3)`,
        [contractId, `${pkg.service_title} (${pkg.package_name})`.slice(0, 200), price],
      );
      await client.query(`UPDATE gig_orders SET contract_id = $2 WHERE id = $1`, [orderId, contractId]);
      return pkg.expert_id;
    });

    await this.notify(expertId, `${user.firstName ?? 'A buyer'} ordered your service; delivery starts once they pay`, orderLink(orderId));
    return this.findOne(orderId, user);
  }

  // ─── Delivery workflow ────────────────────────────────────────────────────

  /** Expert: in_progress | revision_requested -> delivered. The delivery row is written in the milestone transaction. */
  async deliver(id: string, dto: DeliverDto, user: User): Promise<GigOrder> {
    const links = (dto.links ?? []).map((l) => l.trim()).filter(Boolean);
    const bad = links.find((l) => !isHttpsLink(l));
    if (bad) throw new BadRequestException(`Links must be https URLs: ${bad.slice(0, 100)}`);
    const note = dto.note.trim();
    if (!note) throw new BadRequestException('Add a delivery note');

    const order = await this.load(this.db, id);
    if (order.expert_id !== user.id) throw new ForbiddenException('Only the expert of this order delivers it');
    const milestoneId = await this.milestoneOf(order);
    if (!DELIVERABLE.includes(order.status)) {
      throw new ConflictException(
        order.status === 'awaiting_payment' ? 'The buyer has not paid yet; deliver once the order is funded'
          : `An order that is '${order.status.replace('_', ' ')}' can not be delivered`);
    }
    await this.contracts.submitMilestone(order.contract_id as string, milestoneId, deliveryNote(note, links), user, {
      after: async (client) => {
        await client.query(
          `INSERT INTO gig_deliveries (order_id, expert_id, note, links) VALUES ($1,$2,$3,$4::text[])`,
          [id, user.id, note, links],
        );
      },
    });
    return this.findOne(id, user);
  }

  /** Buyer: delivered -> revision_requested, up to the package's revision count (checked under the milestone lock). */
  async requestRevision(id: string, dto: RevisionDto, user: User): Promise<GigOrder> {
    const order = await this.load(this.db, id);
    if (order.buyer_id !== user.id) throw new ForbiddenException('Only the buyer can request a revision');
    if (order.status !== 'delivered') throw new ConflictException('A revision can be requested on a delivered order');
    if (Number(order.revisions_used ?? 0) >= Number(order.revisions)) {
      throw new ConflictException('No revisions are left on this package; accept the delivery or open a dispute');
    }
    const milestoneId = await this.milestoneOf(order);
    await this.contracts.requestRevision(order.contract_id as string, milestoneId, dto.note.trim(), user, {
      before: async (client, milestone) => {
        const { rows } = await client.query<{ revisions: number }>(
          `SELECT revisions FROM gig_orders WHERE id = $1`, [id],
        );
        if (Number(milestone.revision_count) >= Number(rows[0]?.revisions ?? 0)) {
          throw new ConflictException('No revisions are left on this package; accept the delivery or open a dispute');
        }
      },
    });
    return this.findOne(id, user);
  }

  /**
   * Buyer: accept the delivery and release the payment to the expert (accept, then release,
   * both through the contract). If the release step failed after the accept, calling this
   * again only repeats the release.
   */
  async accept(id: string, user: User): Promise<GigOrder> {
    const order = await this.load(this.db, id);
    if (order.buyer_id !== user.id) throw new ForbiddenException('Only the buyer can accept a delivery');
    const contractId = order.contract_id as string;
    const milestoneId = await this.milestoneOf(order);
    if (order.milestone_status === 'submitted') {
      await this.contracts.acceptMilestone(contractId, milestoneId, user);
    } else if (order.milestone_status !== 'accepted') {
      throw new ConflictException('There is no delivery waiting for you to accept');
    }
    await this.contracts.releaseMilestone(contractId, milestoneId, user);
    return this.findOne(id, user);
  }

  /** Buyer, before paying: cancels the contract (nothing was funded). After payment use a dispute. */
  async cancel(id: string, user: User): Promise<GigOrder> {
    const order = await this.load(this.db, id);
    if (order.buyer_id !== user.id) throw new ForbiddenException('Only the buyer can cancel an order');
    if (order.status !== 'awaiting_payment') {
      throw new ConflictException('A paid order can not be cancelled here; open a dispute from the contract instead');
    }
    await this.contracts.cancel(order.contract_id as string, 'Order cancelled by the buyer before payment', user);
    return this.findOne(id, user);
  }

  // ─── Review ───────────────────────────────────────────────────────────────

  /**
   * Buyer, once the order is completed: one review per order, stored in `reviews` with
   * gig_order_id (project_id NULL). The service's and the expert's rating / review_count are
   * recomputed in the same transaction.
   */
  async review(id: string, dto: OrderReviewDto, user: User): Promise<GigOrder> {
    await withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{
        buyer_id: string; expert_id: string; service_id: string; status: string; title: string;
      }>(
        `SELECT o.buyer_id, o.expert_id, o.service_id, o.status, s.title
           FROM gig_orders o JOIN services s ON s.id = o.service_id
          WHERE o.id = $1 FOR UPDATE OF o`,
        [id],
      );
      const order = rows[0];
      if (!order) throw new NotFoundException('Order not found');
      if (order.buyer_id !== user.id) throw new ForbiddenException('Only the buyer can review this order');
      if (order.status !== 'completed') throw new ConflictException('Reviews open once the order is completed');

      // Lock the aggregates' owners so concurrent reviews recompute in turn.
      await client.query(`SELECT 1 FROM services WHERE id = $1 FOR UPDATE`, [order.service_id]);
      await client.query(`SELECT 1 FROM expert_profiles WHERE user_id = $1 FOR UPDATE`, [order.expert_id]);
      try {
        await client.query(
          `INSERT INTO reviews (project_id, gig_order_id, reviewer_id, reviewee_id, rating, comment)
           VALUES (NULL, $1, $2, $3, $4, $5)`,
          [id, user.id, order.expert_id, dto.rating, dto.comment ?? ''],
        );
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('You have already reviewed this order');
        throw err;
      }
      await client.query(
        `UPDATE services s
            SET rating = agg.avg, review_count = agg.n
           FROM (SELECT COALESCE(ROUND(AVG(r.rating)::numeric, 2), 0) AS avg, COUNT(*)::int AS n
                   FROM reviews r JOIN gig_orders o ON o.id = r.gig_order_id WHERE o.service_id = $1) agg
          WHERE s.id = $1`,
        [order.service_id],
      );
      await client.query(
        `UPDATE expert_profiles p
            SET rating = agg.avg, review_count = agg.n
           FROM (SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg, COUNT(*)::int AS n
                   FROM reviews WHERE reviewee_id = $1) agg
          WHERE p.user_id = $1`,
        [order.expert_id],
      );
      await this.notifications.send(
        order.expert_id, `You received a ${dto.rating}-star review for ${order.title}.`, orderLink(id), client,
      );
    });
    return this.findOne(id, user);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async load(db: Pool | PoolClient, id: string): Promise<OrderRow> {
    const { rows } = await db.query<OrderRow>(`${ORDER_SQL} WHERE o.id = $1`, [id]);
    if (!rows.length) throw new NotFoundException(`Order ${id} not found`);
    return rows[0];
  }

  private assertParty(order: OrderRow, user: User, allowAdmin: boolean) {
    const ok = order.buyer_id === user.id || order.expert_id === user.id || (allowAdmin && user.role === 'Admin');
    if (!ok) throw new ForbiddenException();
  }

  private async milestoneOf(order: OrderRow): Promise<string> {
    if (!order.contract_id) throw new ConflictException('This order has no contract yet');
    const { rows } = await this.db.query<{ id: string }>(
      `SELECT id FROM contract_milestones WHERE contract_id = $1 AND seq = 1`, [order.contract_id],
    );
    if (!rows.length) throw new NotFoundException('Order milestone not found');
    return rows[0].id;
  }

  private async notify(userId: string, text: string, link: string) {
    try {
      await this.notifications.send(userId, text, link);
    } catch (err) {
      this.logger.warn(`Notification to ${userId} failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}
