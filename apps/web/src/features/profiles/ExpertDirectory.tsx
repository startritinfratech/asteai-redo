/* Server-renderable pieces of the public directory: no hooks, no client state. */
import Link from 'next/link';
import { AVAILABILITY_LABEL, ENGAGEMENT_LABEL, filtersToQuery, primaryRate, type ExpertFilters } from './format';
import { AVAILABILITIES, ENGAGEMENT_MODES, type ExpertCard } from './types';
import styles from './profiles.module.css';

export function Stars({ rating, count }: { rating: number; count: number }) {
  if (!count) return <span className={styles.muted}>No reviews yet</span>;
  return (
    <span className={styles.stars}>
      <span aria-hidden>★</span> {rating.toFixed(1)}
      <span className={styles.muted}> ({count} review{count === 1 ? '' : 's'})</span>
      <span className={styles.srOnly}>, rated {rating.toFixed(1)} out of 5</span>
    </span>
  );
}

export function Avatar({ name, url }: { name: string; url: string | null }) {
  return (
    <span className={styles.avatar} aria-hidden>
      {/* eslint-disable-next-line @next/next/no-img-element -- user-supplied host, not in next/image domains */}
      {url ? <img src={url} alt="" /> : name.charAt(0).toUpperCase()}
    </span>
  );
}

export function PassportBadge({ tier }: { tier: string }) {
  return <span className={styles.badge} title="Holds a valid AsteAI Talent Passport">✓ Passport · {tier}</span>;
}

export function ExpertCardView({ expert }: { expert: ExpertCard }) {
  const rate = primaryRate(expert);
  return (
    <article className={styles.card}>
      <div className={styles.cardTop}>
        <Avatar name={expert.name} url={expert.avatarUrl} />
        <div className={styles.stack} style={{ gap: 4 }}>
          <h2 className={styles.cardName}>
            <Link href={`/experts/${expert.userId}`}>{expert.name}</Link>
          </h2>
          {expert.passport && <PassportBadge tier={expert.passport.tier} />}
        </div>
      </div>
      <p className={styles.headline}>{expert.headline}</p>
      {expert.skills.length > 0 && (
        <ul className={styles.skills} aria-label="Skills">
          {expert.skills.slice(0, 6).map((s) => <li key={s} className={styles.skill}>{s}</li>)}
          {expert.skills.length > 6 && <li className={styles.skill}>+{expert.skills.length - 6}</li>}
        </ul>
      )}
      <div className={styles.cardFoot}>
        <span className={styles.rate}>{rate ?? 'Rate on request'}</span>
        <Stars rating={expert.rating} count={expert.reviewCount} />
      </div>
      <span className={styles.muted}>
        {AVAILABILITY_LABEL[expert.availability]}{expert.location ? ` · ${expert.location}` : ''}
      </span>
    </article>
  );
}

/**
 * A plain GET form, so filtering works without JavaScript and every result page has a URL.
 * `basePath` is the directory page it submits to: the public /experts or the in-app one.
 */
export function ExpertFiltersForm({ filters, basePath = '/experts' }: { filters: ExpertFilters; basePath?: string }) {
  return (
    <form className={styles.filters} method="get" action={basePath} role="search" aria-label="Filter experts">
      <label>
        Search
        <input type="search" name="q" defaultValue={filters.q ?? ''} maxLength={200} placeholder="e.g. computer vision" />
      </label>
      <label>
        Skill
        <input name="skill" defaultValue={filters.skill ?? ''} maxLength={40} placeholder="e.g. PyTorch" />
      </label>
      <label>
        Domain
        <input name="domain" defaultValue={filters.domain ?? ''} maxLength={40} placeholder="e.g. Robotics" />
      </label>
      <div className={styles.rateRow}>
        <label>
          Min hourly rate
          <input type="number" name="minRate" min={0} inputMode="numeric" defaultValue={filters.minRate ?? ''} />
        </label>
        <label>
          Max hourly rate
          <input type="number" name="maxRate" min={0} inputMode="numeric" defaultValue={filters.maxRate ?? ''} />
        </label>
      </div>
      <label>
        Availability
        <select name="availability" defaultValue={filters.availability ?? ''}>
          <option value="">Any</option>
          {AVAILABILITIES.map((a) => <option key={a} value={a}>{AVAILABILITY_LABEL[a]}</option>)}
        </select>
      </label>
      <label>
        Engagement
        <select name="engagement" defaultValue={filters.engagement ?? ''}>
          <option value="">Any</option>
          {ENGAGEMENT_MODES.map((m) => <option key={m} value={m}>{ENGAGEMENT_LABEL[m]}</option>)}
        </select>
      </label>
      <label>
        Sort by
        <select name="sort" defaultValue={filters.sort ?? 'relevance'}>
          <option value="relevance">Best match</option>
          <option value="rating">Highest rated</option>
          <option value="rate">Lowest hourly rate</option>
        </select>
      </label>
      <button type="submit" className={styles.ctaBtn}>Apply filters</button>
      <Link href={basePath} className={styles.muted}>Clear filters</Link>
    </form>
  );
}

export function Pager({ filters, page, pageSize, total, basePath = '/experts' }: {
  filters: ExpertFilters; page: number; pageSize: number; total: number; basePath?: string;
}) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (pages <= 1) return null;
  const link = (p: number, label: string, rel?: string) =>
    <Link href={`${basePath}${filtersToQuery({ ...filters, page: p })}`} rel={rel}>{label}</Link>;
  return (
    <nav className={styles.pager} aria-label="Result pages">
      {page > 1 ? link(page - 1, '← Previous', 'prev') : <span aria-disabled="true">← Previous</span>}
      <span className={styles.muted} aria-current="page">Page {page} of {pages}</span>
      {page < pages ? link(page + 1, 'Next →', 'next') : <span aria-disabled="true">Next →</span>}
    </nav>
  );
}
