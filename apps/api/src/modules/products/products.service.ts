import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type { MyProduct, ProductCard, ProductDetail, ProductPage, ProductStatus, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import type { Pagination } from '../../common/utils/pagination';
import { cleanList, publicName, slugify } from '../gigs/gig-rules';
import { NotificationsService } from '../notifications/notifications.service';
import type { ProductDto } from './dto/product.dto';
import { EDITABLE, SELLER_MOVES, submitProblem } from './product-rules';

interface ProductRow {
  id: string; seller_id: string; slug: string; title: string; summary: string; description: string; category: string;
  tags: string[]; price_minor: number; currency: string; license: ProductCard['license']; file_key: string | null;
  status: ProductStatus; review_note: string | null; published_at: Date | null; updated_at: Date;
  first_name?: string | null; last_name?: string | null;
}

const card = (r: ProductRow): ProductCard => ({
  id: r.id, slug: r.slug, title: r.title, summary: r.summary, category: r.category, tags: r.tags,
  priceMinor: r.price_minor, currency: r.currency, license: r.license,
  sellerName: publicName(r.first_name, r.last_name), publishedAt: r.published_at ? r.published_at.toISOString() : null,
});
const detail = (r: ProductRow): ProductDetail => ({ ...card(r), description: r.description });
const mine = (r: ProductRow): MyProduct => ({
  ...detail(r), status: r.status, reviewNote: r.review_note, hasFile: Boolean(r.file_key), updatedAt: r.updated_at.toISOString(),
});

const PUBLIC_COLUMNS = `p.*, u.first_name, u.last_name`;

/** Digital products: the public catalogue, the seller's lifecycle, and admin review. */
@Injectable()
export class ProductsService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  async list(q: { q?: string; category?: string }, page: Pagination): Promise<ProductPage> {
    const params: unknown[] = [];
    const where = [`p.status = 'active'`];
    if (q.q) {
      params.push(`%${q.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
      where.push(`(p.title ILIKE $${params.length} OR p.summary ILIKE $${params.length} OR array_to_string(p.tags, ' ') ILIKE $${params.length})`);
    }
    if (q.category) {
      params.push(q.category);
      where.push(`p.category = $${params.length}`);
    }
    params.push(page.pageSize, page.offset);
    const { rows } = await this.db.query<ProductRow & { total: string }>(
      `SELECT ${PUBLIC_COLUMNS}, COUNT(*) OVER () AS total
         FROM products p JOIN user_accounts u ON u.id = p.seller_id
        WHERE ${where.join(' AND ')}
        ORDER BY p.published_at DESC NULLS LAST, p.id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params,
    );
    return { items: rows.map(card), total: Number(rows[0]?.total ?? 0), page: page.page, pageSize: page.pageSize };
  }

  /** Public detail: only active products; anything else is a 404 (no status leak). */
  async bySlug(slug: string): Promise<ProductDetail> {
    const { rows } = await this.db.query<ProductRow>(
      `SELECT ${PUBLIC_COLUMNS} FROM products p JOIN user_accounts u ON u.id = p.seller_id
        WHERE p.slug = $1 AND p.status = 'active'`,
      [slug],
    );
    if (!rows.length) throw new NotFoundException('Product not found');
    return detail(rows[0]);
  }

  async mine(user: User): Promise<MyProduct[]> {
    const { rows } = await this.db.query<ProductRow>(
      `SELECT * FROM products WHERE seller_id = $1 ORDER BY updated_at DESC`, [user.id],
    );
    return rows.map(mine);
  }

  async create(dto: ProductDto, user: User): Promise<MyProduct> {
    const id = generateId('PRD');
    const { rows } = await this.db.query<ProductRow>(
      `INSERT INTO products (id, seller_id, slug, title, summary, description, category, tags, price_minor, license)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [id, user.id, `${slugify(dto.title)}-${id.slice(4).toLowerCase()}`, dto.title, dto.summary, dto.description,
        dto.category, cleanList(dto.tags), dto.priceMinor, dto.license],
    );
    return mine(rows[0]);
  }

  /** Editing a paused (previously approved) product sends it back to draft for re-review. */
  async update(id: string, dto: ProductDto, user: User): Promise<MyProduct> {
    return withTransaction(this.db, async (client) => {
      const p = await this.lockOwned(client, id, user);
      if (!EDITABLE.includes(p.status)) {
        throw new ConflictException(p.status === 'pending'
          ? 'This product is waiting for review; it can not be edited meanwhile'
          : 'Pause an active product before editing it');
      }
      const { rows } = await client.query<ProductRow>(
        `UPDATE products SET title = $2, summary = $3, description = $4, category = $5, tags = $6, price_minor = $7,
                license = $8, status = CASE WHEN status = 'paused' THEN 'draft' ELSE status END, updated_at = NOW()
          WHERE id = $1 RETURNING *`,
        [id, dto.title, dto.summary, dto.description, dto.category, cleanList(dto.tags), dto.priceMinor, dto.license],
      );
      return mine(rows[0]);
    });
  }

  async move(id: string, action: keyof typeof SELLER_MOVES, user: User): Promise<MyProduct> {
    const rule = SELLER_MOVES[action];
    return withTransaction(this.db, async (client) => {
      const p = await this.lockOwned(client, id, user);
      if (!rule.from.includes(p.status)) throw new ConflictException(`A '${p.status}' product can not be ${action === 'submit' ? 'submitted' : `${action}d`}`);
      if (action === 'submit') {
        await this.assertApprovedExpert(client, user.id);
        const problem = submitProblem(p);
        if (problem) throw new BadRequestException(problem);
      }
      const { rows } = await client.query<ProductRow>(
        `UPDATE products SET status = $2::text, review_note = CASE WHEN $2::text = 'pending' THEN NULL ELSE review_note END, updated_at = NOW()
          WHERE id = $1 AND status = $3 RETURNING *`,
        [id, rule.to, p.status],
      );
      if (!rows.length) throw new ConflictException('The product changed meanwhile; reload and try again');
      if (action === 'submit') {
        const { rows: admins } = await client.query<{ id: string }>(
          `SELECT id FROM user_accounts WHERE role = 'Admin' AND account_status = 'active'`,
        );
        for (const a of admins) {
          await this.notifications.send(a.id, `New product "${p.title}" is waiting for approval`, '/platform/product-approvals', client);
        }
      }
      return mine(rows[0]);
    });
  }

  // ── Admin ──────────────────────────────────────────────────────────────────

  async adminList(status: ProductStatus = 'pending'): Promise<MyProduct[]> {
    const { rows } = await this.db.query<ProductRow>(
      `SELECT ${PUBLIC_COLUMNS} FROM products p JOIN user_accounts u ON u.id = p.seller_id
        WHERE p.status = $1 ORDER BY p.updated_at ASC LIMIT 200`,
      [status],
    );
    return rows.map(mine);
  }

  async review(id: string, status: 'active' | 'rejected', note: string | undefined): Promise<MyProduct> {
    if (status === 'rejected' && !note) throw new BadRequestException('Give the seller a reason when rejecting');
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<ProductRow>(
        `UPDATE products SET status = $2::text, review_note = $3,
                published_at = CASE WHEN $2::text = 'active' THEN COALESCE(published_at, NOW()) ELSE published_at END,
                updated_at = NOW()
          WHERE id = $1 AND status = 'pending' RETURNING *`,
        [id, status, note ?? null],
      );
      if (!rows.length) throw new ConflictException('Only a pending product can be reviewed');
      const p = rows[0];
      await this.notifications.send(
        p.seller_id,
        status === 'active' ? `Your product "${p.title}" is live` : `Your product "${p.title}" was not approved: ${note}`,
        '/platform/products',
        client,
      );
      return mine(p);
    });
  }

  private async lockOwned(client: PoolClient, id: string, user: User): Promise<ProductRow> {
    const { rows } = await client.query<ProductRow>(`SELECT * FROM products WHERE id = $1 FOR UPDATE`, [id]);
    if (!rows.length || rows[0].seller_id !== user.id) throw new NotFoundException('Product not found');
    return rows[0];
  }

  private async assertApprovedExpert(client: PoolClient, userId: string) {
    const { rows } = await client.query<{ status: string }>(`SELECT status FROM expert_profiles WHERE user_id = $1`, [userId]);
    if (rows[0]?.status !== 'approved') {
      throw new ForbiddenException('Your expert profile must be approved before you can submit a product');
    }
  }
}
