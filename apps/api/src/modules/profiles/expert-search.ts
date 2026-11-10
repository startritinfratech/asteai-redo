import { BadRequestException } from '@nestjs/common';
import { paginate } from '../../common/utils/pagination';
import type { ListExpertsQueryDto } from './dto/profile.dto';

/**
 * Conditions every publicly listed expert meets: an approved profile on an active,
 * not banned / suspended, not deleted Freelancer account.
 */
export const PUBLIC_EXPERT_SQL = `p.status = 'approved'
     AND u.role = 'Freelancer'
     AND u.account_status = 'active' AND u.deleted_at IS NULL AND u.is_banned = FALSE
     AND (u.is_suspended = FALSE OR (u.suspended_until IS NOT NULL AND u.suspended_until <= NOW()))`;

/** The holder's newest Valid, discoverable, unexpired passport — the only one shown as a badge. */
export const PASSPORT_BADGE_JOIN = `LEFT JOIN LATERAL (
       SELECT pp.id, pp.tier FROM passports pp
        WHERE pp.user_id = p.user_id AND pp.status = 'Valid' AND pp.discoverable = TRUE
          AND (pp.valid_until IS NULL OR pp.valid_until > NOW())
        ORDER BY pp.issued_at DESC LIMIT 1
     ) badge ON TRUE`;

/** Public columns of a directory card. Deliberately no `u.email`, `p.admin_note`, `p.reviewed_by`. */
export const CARD_COLUMNS = `p.user_id, p.headline, p.summary, p.domains, p.skills, p.languages, p.years_experience,
       p.hourly_rate, p.daily_rate, p.fixed_from, p.currency, p.engagement_modes, p.availability, p.location,
       p.portfolio_url, p.linkedin_url, p.github_url, p.status, p.rating, p.review_count, p.completion,
       p.created_at, p.updated_at, u.first_name, u.last_name, u.avatar_url, u.created_at AS member_since,
       badge.id AS passport_id, badge.tier AS passport_tier`;

export interface BuiltQuery {
  text: string;
  values: unknown[];
  page: number;
  pageSize: number;
}

/**
 * Turns directory filters into one parameterised query. User input only ever lands in
 * `values` and is referenced as $n; the SQL text is assembled from fixed fragments.
 * `COUNT(*) OVER ()` returns the total with the page.
 */
export function buildExpertSearch(f: ListExpertsQueryDto): BuiltQuery {
  if (f.minRate !== undefined && f.maxRate !== undefined && f.minRate > f.maxRate) {
    throw new BadRequestException('minRate must not be greater than maxRate');
  }
  const values: unknown[] = [];
  const bind = (v: unknown) => {
    values.push(v);
    return `$${values.length}`;
  };
  const where = [PUBLIC_EXPERT_SQL];

  let tsquery: string | null = null;
  if (f.q) {
    tsquery = `plainto_tsquery('english', ${bind(f.q)})`;
    where.push(`p.search @@ ${tsquery}`);
  }
  // Tags are stored as typed; match them case-insensitively.
  if (f.domain) where.push(`EXISTS (SELECT 1 FROM unnest(p.domains) d WHERE lower(d) = lower(${bind(f.domain)}))`);
  if (f.skill) where.push(`EXISTS (SELECT 1 FROM unnest(p.skills) s WHERE lower(s) = lower(${bind(f.skill)}))`);
  if (f.minRate !== undefined) where.push(`p.hourly_rate >= ${bind(f.minRate)}`);
  if (f.maxRate !== undefined) where.push(`p.hourly_rate <= ${bind(f.maxRate)}`);
  if (f.availability) where.push(`p.availability = ${bind(f.availability)}`);
  if (f.engagement) where.push(`${bind(f.engagement)} = ANY(p.engagement_modes)`);

  const sort = f.sort ?? 'relevance';
  const byRating = 'p.rating DESC, p.review_count DESC, p.completion DESC';
  const order =
    sort === 'rate' ? 'p.hourly_rate ASC NULLS LAST, p.rating DESC'
    : sort === 'rating' || !tsquery ? byRating
    : `ts_rank_cd(p.search, ${tsquery}) DESC, ${byRating}`;

  const { page, pageSize, offset } = paginate(f.page, f.pageSize, 12, 50);
  const text = `SELECT ${CARD_COLUMNS}, COUNT(*) OVER () AS total
      FROM expert_profiles p
      JOIN user_accounts u ON u.id = p.user_id
      ${PASSPORT_BADGE_JOIN}
     WHERE ${where.join('\n       AND ')}
     ORDER BY ${order}, p.user_id
     LIMIT ${bind(pageSize)} OFFSET ${bind(offset)}`;
  return { text, values, page, pageSize };
}
