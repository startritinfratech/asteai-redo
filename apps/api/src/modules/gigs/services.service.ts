import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type {
  AdminServiceItem, MyService, ServiceDetail, ServicePage, ServiceStatus, User,
} from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import type {
  AdminServicesQueryDto, ListServicesQueryDto, PackagesDto, ServiceDto, SetServiceStatusDto,
} from './dto/gig.dto';
import {
  ADMIN_DECISIONS, assertPackageSet, cleanList, EDITABLE, slugify, SUBMITTABLE, submitProblem,
} from './gig-rules';
import {
  mapAdminItem, mapCard, mapDetail, mapMine, PackageRow, ServiceRow,
} from './gig.mapper';
import { buildServiceSearch } from './service-search';

const MAX_SERVICES_PER_EXPERT = 20;

const fullName = (u: User) => [u.firstName, u.lastName].filter(Boolean).join(' ');

/**
 * Service listings: the expert's draft / submit / pause lifecycle, the admin decision and
 * the public catalogue. Content is only editable while draft, rejected or paused, and
 * any edit puts the listing back to draft so a live listing can't be changed after approval.
 */
@Injectable()
export class ServicesService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  // ─── Expert ───────────────────────────────────────────────────────────────

  async create(dto: ServiceDto, user: User): Promise<MyService> {
    const { rows: count } = await this.db.query<{ n: string }>(
      `SELECT COUNT(*) AS n FROM services WHERE expert_id = $1`, [user.id],
    );
    if (Number(count[0]?.n ?? 0) >= MAX_SERVICES_PER_EXPERT) {
      throw new ConflictException(`You can have at most ${MAX_SERVICES_PER_EXPERT} services`);
    }
    const id = generateId('SVC');
    // The id suffix keeps slugs unique without a retry loop.
    const slug = `${slugify(dto.title)}-${id.slice(4).toLowerCase()}`;
    const tags = cleanList(dto.tags);
    const { rows } = await this.db.query<ServiceRow>(
      `INSERT INTO services (id, expert_id, title, slug, category, summary, description, tags)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8::text[]) RETURNING *`,
      [id, user.id, dto.title, slug, dto.category, dto.summary, dto.description, tags],
    );
    return mapMine(rows[0], []);
  }

  async update(id: string, dto: ServiceDto, user: User): Promise<MyService> {
    return withTransaction(this.db, async (client) => {
      const service = await this.lockOwned(client, id, user);
      this.assertEditable(service.status);
      const { rows } = await client.query<ServiceRow>(
        `UPDATE services
            SET title = $2, category = $3, summary = $4, description = $5, tags = $6::text[],
                status = 'draft', updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, dto.title, dto.category, dto.summary, dto.description, cleanList(dto.tags)],
      );
      return mapMine(rows[0], await this.packagesOf(client, id));
    });
  }

  /**
   * Replaces the service's package set (1 to 3 tiers). Tiers that were dropped are deleted,
   * or only deactivated (active = FALSE) when an order already points at them; adding such a
   * tier back reactivates it. Packages keep their id per tier, so existing
   * orders (which snapshot price, days and revisions) are unaffected.
   */
  async setPackages(id: string, dto: PackagesDto, user: User): Promise<MyService> {
    assertPackageSet(dto.packages);
    return withTransaction(this.db, async (client) => {
      const service = await this.lockOwned(client, id, user);
      this.assertEditable(service.status);
      // A dropped tier that has orders is only deactivated (orders keep joining the row);
      // one without orders is deleted.
      const keep = dto.packages.map((p) => p.tier);
      await client.query(
        `DELETE FROM service_packages sp
          WHERE sp.service_id = $1 AND sp.tier <> ALL($2::text[])
            AND NOT EXISTS (SELECT 1 FROM gig_orders o WHERE o.package_id = sp.id)`,
        [id, keep],
      );
      await client.query(
        `UPDATE service_packages SET active = FALSE, updated_at = NOW()
          WHERE service_id = $1 AND tier <> ALL($2::text[]) AND active`,
        [id, keep],
      );
      for (const p of dto.packages) {
        await client.query(
          `INSERT INTO service_packages (id, service_id, tier, name, description, price, delivery_days, revisions, features)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9::text[])
           ON CONFLICT (service_id, tier) DO UPDATE
             SET name = EXCLUDED.name, description = EXCLUDED.description, price = EXCLUDED.price,
                 delivery_days = EXCLUDED.delivery_days, revisions = EXCLUDED.revisions,
                 features = EXCLUDED.features, active = TRUE, updated_at = NOW()`,
          [generateId('PKG'), id, p.tier, p.name, p.description ?? '', p.price, p.deliveryDays, p.revisions, cleanList(p.features)],
        );
      }
      const { rows } = await client.query<ServiceRow>(
        `UPDATE services SET status = 'draft', updated_at = NOW() WHERE id = $1 RETURNING *`, [id],
      );
      return mapMine(rows[0], await this.packagesOf(client, id));
    });
  }

  /** draft | rejected -> pending. Only experts whose profile is approved may submit. */
  async submit(id: string, user: User): Promise<MyService> {
    const { service, packages } = await withTransaction(this.db, async (client) => {
      const service = await this.lockOwned(client, id, user);
      if (!SUBMITTABLE.includes(service.status)) {
        throw new ConflictException(`A '${service.status}' service can not be submitted`);
      }
      await this.assertApprovedExpert(client, user.id, 'submit');
      const packages = await this.packagesOf(client, id);
      const problem = submitProblem(service, packages.length);
      if (problem) throw new BadRequestException(problem);
      const { rows } = await client.query<ServiceRow>(
        `UPDATE services SET status = 'pending', admin_note = NULL, updated_at = NOW()
          WHERE id = $1 AND status = $2 RETURNING *`,
        [id, service.status],
      );
      if (!rows.length) throw new ConflictException('The service changed meanwhile; reload and try again');
      const { rows: admins } = await client.query<{ id: string }>(
        `SELECT id FROM user_accounts WHERE role = 'Admin' AND account_status = 'active'`,
      );
      for (const a of admins) {
        await this.notifications.send(a.id, `New service "${service.title}" is waiting for approval`, '/platform/service-approvals', client);
      }
      return { service: rows[0], packages };
    });
    return mapMine(service, packages);
  }

  /** published -> paused (hidden from the catalogue; existing orders carry on). */
  pause(id: string, user: User): Promise<MyService> {
    return this.moveOwned(id, user, 'published', 'paused');
  }

  /** paused -> published again (the content was not edited while paused, or it would be a draft). */
  resume(id: string, user: User): Promise<MyService> {
    return this.moveOwned(id, user, 'paused', 'published', true);
  }

  async mine(user: User): Promise<MyService[]> {
    const { rows } = await this.db.query<ServiceRow>(
      `SELECT * FROM services WHERE expert_id = $1 ORDER BY updated_at DESC LIMIT 100`, [user.id],
    );
    const packages = await this.packagesFor(this.db, rows.map((r) => r.id));
    return rows.map((r) => mapMine(r, packages.get(r.id) ?? []));
  }

  // ─── Admin ────────────────────────────────────────────────────────────────

  async adminList(query: AdminServicesQueryDto): Promise<AdminServiceItem[]> {
    const { rows } = await this.db.query<ServiceRow>(
      `SELECT s.*, u.first_name, u.last_name
         FROM services s JOIN user_accounts u ON u.id = s.expert_id
        WHERE s.status = $1
        ORDER BY s.updated_at ASC LIMIT 200`,
      [query.status ?? 'pending'],
    );
    const packages = await this.packagesFor(this.db, rows.map((r) => r.id));
    return rows.map((r) => mapAdminItem(r, packages.get(r.id) ?? []));
  }

  async setStatus(id: string, dto: SetServiceStatusDto, admin: User): Promise<AdminServiceItem> {
    const note = dto.note?.trim() || null;
    if (dto.status === 'rejected' && (!note || note.length < 5)) {
      throw new BadRequestException('Add a note (5+ characters) telling the expert what to change');
    }
    return withTransaction(this.db, async (client) => {
      const { rows: found } = await client.query<ServiceRow>(`SELECT * FROM services WHERE id = $1 FOR UPDATE`, [id]);
      if (!found.length) throw new NotFoundException('Service not found');
      const from = found[0].status;
      if (!ADMIN_DECISIONS[from].includes(dto.status)) {
        throw new ConflictException(`A ${from} service can not be marked ${dto.status}`);
      }
      const { rows } = await client.query<ServiceRow>(
        `UPDATE services s SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
           FROM user_accounts u
          WHERE s.id = $1 AND u.id = s.expert_id
          RETURNING s.*, u.first_name, u.last_name, u.email`,
        [id, dto.status, note, admin.id],
      );
      const row = rows[0] as ServiceRow & { email: string | null };
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          admin.id, fullName(admin), admin.role,
          dto.status === 'published' ? 'Approved service' : 'Rejected service', `service:${id}`,
          JSON.stringify({ from, to: dto.status, note }),
        ],
      );
      await this.notifications.send(
        row.expert_id,
        dto.status === 'published'
          ? `Your service "${row.title}" is approved and live.`
          : `Your service "${row.title}" was not approved. Open it to see the note.`,
        '/platform/my-services', client,
      );
      if (row.email) {
        await this.email.enqueue('service-decision', row.email, {
          firstName: row.first_name ?? '', decision: dto.status, title: row.title, note, path: '/platform/my-services',
        }, { userId: row.expert_id, client, dedupeKey: `service-decision:${id}:${new Date(row.updated_at as Date).getTime()}` });
      }
      return mapAdminItem(row, await this.packagesOf(client, id));
    });
  }

  // ─── Public ───────────────────────────────────────────────────────────────

  async list(filters: ListServicesQueryDto): Promise<ServicePage> {
    const q = buildServiceSearch(filters);
    const { rows } = await this.db.query<ServiceRow>(q.text, q.values);
    return {
      items: rows.map(mapCard),
      total: rows.length ? Number(rows[0].total) : 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /** Published services are public; the owner and admins can also open an unpublished one. */
  async detail(slug: string, user: User | null): Promise<ServiceDetail> {
    const { rows } = await this.db.query<ServiceRow>(
      `SELECT s.*, u.first_name, u.last_name, p.rating AS expert_rating
         FROM services s
         JOIN user_accounts u ON u.id = s.expert_id
         LEFT JOIN expert_profiles p ON p.user_id = s.expert_id
        WHERE s.slug = $1`,
      [slug],
    );
    const row = rows[0];
    if (!row) throw new NotFoundException('Service not found');
    const isOwner = Boolean(user && user.id === row.expert_id);
    const isAdmin = user?.role === 'Admin';
    if (row.status !== 'published' && !isOwner && !isAdmin) throw new NotFoundException('Service not found');
    return mapDetail(row, await this.packagesOf(this.db, row.id), isOwner);
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private async moveOwned(
    id: string, user: User, from: ServiceStatus, to: ServiceStatus, needsApproval = false,
  ): Promise<MyService> {
    return withTransaction(this.db, async (client) => {
      const service = await this.lockOwned(client, id, user);
      if (service.status !== from) throw new ConflictException(`Only a ${from} service can be moved to ${to}`);
      if (needsApproval) await this.assertApprovedExpert(client, user.id, 'resume');
      const { rows } = await client.query<ServiceRow>(
        `UPDATE services SET status = $2, updated_at = NOW() WHERE id = $1 AND status = $3 RETURNING *`,
        [id, to, from],
      );
      if (!rows.length) throw new ConflictException('The service changed meanwhile; reload and try again');
      return mapMine(rows[0], await this.packagesOf(client, id));
    });
  }

  private assertEditable(status: ServiceStatus) {
    if (!EDITABLE.includes(status)) {
      throw new ConflictException(
        status === 'pending' ? 'This service is waiting for review; it can not be edited meanwhile'
          : 'Pause a published service before editing it');
    }
  }

  private async lockOwned(client: PoolClient, id: string, user: User): Promise<ServiceRow> {
    const { rows } = await client.query<ServiceRow>(`SELECT * FROM services WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length) throw new NotFoundException('Service not found');
    if (rows[0].expert_id !== user.id) throw new ForbiddenException('This is not your service');
    return rows[0];
  }

  private async assertApprovedExpert(client: PoolClient, userId: string, verb: string) {
    const { rows } = await client.query<{ status: string }>(
      `SELECT status FROM expert_profiles WHERE user_id = $1`, [userId],
    );
    if (rows[0]?.status !== 'approved') {
      throw new ForbiddenException(`Your expert profile must be approved before you can ${verb} a service`);
    }
  }

  private async packagesOf(db: Pool | PoolClient, serviceId: string): Promise<PackageRow[]> {
    return (await this.packagesFor(db, [serviceId])).get(serviceId) ?? [];
  }

  private async packagesFor(db: Pool | PoolClient, ids: string[]): Promise<Map<string, PackageRow[]>> {
    const out = new Map<string, PackageRow[]>();
    if (!ids.length) return out;
    const { rows } = await db.query<PackageRow>(
      `SELECT * FROM service_packages WHERE service_id = ANY($1::text[]) AND active`, [ids],
    );
    for (const r of rows) out.set(r.service_id, [...(out.get(r.service_id) ?? []), r]);
    return out;
  }
}
