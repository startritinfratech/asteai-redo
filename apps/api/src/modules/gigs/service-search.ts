import { BadRequestException } from '@nestjs/common';
import { paginate } from '../../common/utils/pagination';
import { PUBLIC_EXPERT_SQL } from '../profiles/expert-search';
import type { ListServicesQueryDto } from './dto/gig.dto';

export interface BuiltQuery { text: string; values: unknown[]; page: number; pageSize: number }

/**
 * The public catalogue query. Only published services of experts who are still publicly
 * listable (approved profile, active account) come back, and only public columns: no email,
 * no admin note, no expert id. User input lands in `values` and is referenced as $n; the
 * SQL text itself is assembled from fixed fragments (the sort is picked from a whitelist).
 */
export function buildServiceSearch(f: ListServicesQueryDto): BuiltQuery {
  if (f.minPrice !== undefined && f.maxPrice !== undefined && f.minPrice > f.maxPrice) {
    throw new BadRequestException('minPrice must not be greater than maxPrice');
  }
  const values: unknown[] = [];
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const where = [`s.status = 'published'`, PUBLIC_EXPERT_SQL, 'pk.price IS NOT NULL'];

  let tsquery: string | null = null;
  if (f.q) {
    tsquery = `plainto_tsquery('english', ${bind(f.q)})`;
    where.push(`s.search @@ ${tsquery}`);
  }
  if (f.category) where.push(`lower(s.category) = lower(${bind(f.category)})`);
  if (f.minPrice !== undefined) where.push(`pk.price >= ${bind(f.minPrice)}`);
  if (f.maxPrice !== undefined) where.push(`pk.price <= ${bind(f.maxPrice)}`);

  const byRating = 's.rating DESC, s.review_count DESC, s.updated_at DESC';
  const sort = f.sort ?? 'relevance';
  const order =
    sort === 'newest' ? 's.created_at DESC'
    : sort === 'price_asc' ? 'pk.price ASC, s.rating DESC'
    : sort === 'price_desc' ? 'pk.price DESC, s.rating DESC'
    : sort === 'rating' || !tsquery ? byRating
    : `ts_rank_cd(s.search, ${tsquery}) DESC, ${byRating}`;

  const { page, pageSize, offset } = paginate(f.page, f.pageSize, 12, 48);
  const text = `SELECT s.id, s.slug, s.title, s.category, s.summary, s.tags, s.rating, s.review_count,
       s.created_at, s.updated_at, u.first_name, u.last_name, p.rating AS expert_rating,
       pk.price AS from_price, pk.delivery_days AS from_days, COUNT(*) OVER () AS total
      FROM services s
      JOIN expert_profiles p ON p.user_id = s.expert_id
      JOIN user_accounts u ON u.id = s.expert_id
      LEFT JOIN LATERAL (
        SELECT sp.price, sp.delivery_days FROM service_packages sp
         WHERE sp.service_id = s.id AND sp.active ORDER BY sp.price ASC LIMIT 1
      ) pk ON TRUE
     WHERE ${where.join('\n       AND ')}
     ORDER BY ${order}, s.id
     LIMIT ${bind(pageSize)} OFFSET ${bind(offset)}`;
  return { text, values, page, pageSize };
}
