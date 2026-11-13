import type { Metadata } from 'next';
import Link from 'next/link';
import { SERVICE_CATEGORIES, SERVICE_SORTS, type ServicePage, type ServiceSort } from '@asteai/types';
import { EmptyState } from '@/components/ui';
import { inr } from '@/features/gigs/format';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';

type SearchParams = Record<string, string | string[] | undefined>;

const SORT_LABEL: Record<ServiceSort, string> = {
  relevance: 'Best match', newest: 'Newest', price_asc: 'Price: low to high', price_desc: 'Price: high to low', rating: 'Top rated',
};

const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function parse(sp: SearchParams) {
  const sort = one(sp.sort) as ServiceSort;
  const page = Math.max(1, Number.parseInt(one(sp.page), 10) || 1);
  return {
    q: one(sp.q).slice(0, 100),
    category: (SERVICE_CATEGORIES as readonly string[]).includes(one(sp.category)) ? one(sp.category) : '',
    sort: SERVICE_SORTS.includes(sort) ? sort : 'relevance',
    page,
  };
}

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const f = parse(searchParams);
  const filtered = Boolean(f.q || f.category || f.sort !== 'relevance' || f.page > 1);
  return {
    title: 'DeepTech Gigs & Services',
    description: 'Fixed-scope services from approved experts. Pay into escrow and release payment when you accept the delivery.',
    alternates: { canonical: '/services' },
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function PublicServicesPage({ searchParams }: { searchParams: SearchParams }) {
  const f = parse(searchParams);
  let data: ServicePage | null = null;
  let failed = false;
  try {
    data = await serverGet<ServicePage>('/services', {
      params: { q: f.q || undefined, category: f.category || undefined, sort: f.sort === 'relevance' ? undefined : f.sort, page: f.page },
    });
  } catch (err) {
    if (!(err instanceof ApiUnavailable || err instanceof ApiNotFound)) throw err;
    failed = true;
  }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const pageHref = (p: number) => {
    const q = new URLSearchParams();
    if (f.q) q.set('q', f.q);
    if (f.category) q.set('category', f.category);
    if (f.sort !== 'relevance') q.set('sort', f.sort);
    if (p > 1) q.set('page', String(p));
    const qs = q.toString();
    return qs ? `/services?${qs}` : '/services';
  };

  return (
    <PageShell>
      <PageHero eyebrow="Talent sourcing" title="DeepTech gigs & services">
        Fixed-scope packages from approved experts. You pay into escrow and release the money when you accept the delivery.
      </PageHero>
      <section className={`${marketing.container} ${s.listSection}`} aria-labelledby="results-h">
        {/* A plain GET form: filtering works without JavaScript and every result page has a URL. */}
        <form className={s.filters} action="/services" method="get" role="search">
          <label className={s.control}>
            Search
            <input name="q" defaultValue={f.q} maxLength={100} placeholder="e.g. security audit" />
          </label>
          <label className={s.control}>
            Category
            <select name="category" defaultValue={f.category}>
              <option value="">All categories</option>
              {SERVICE_CATEGORIES.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className={s.control}>
            Sort by
            <select name="sort" defaultValue={f.sort}>
              {SERVICE_SORTS.map((o) => <option key={o} value={o}>{SORT_LABEL[o]}</option>)}
            </select>
          </label>
          <button type="submit" className={`${marketing.btn} ${marketing.btnPrimary}`}>Search</button>
        </form>

        <div className={s.listHead}>
          <h2 id="results-h" className={s.muted} aria-live="polite">
            {data ? `${data.total} service${data.total === 1 ? '' : 's'}` : 'Services'}
          </h2>
          {(f.q || f.category || f.sort !== 'relevance') && <Link href="/services" className={marketing.textLink}>Clear filters</Link>}
        </div>

        {failed && (
          <div className={s.notice} role="alert">
            <strong>Services are temporarily unavailable.</strong> Please try again shortly.
          </div>
        )}
        {data && data.items.length === 0 && (
          <EmptyState title="No services match" action={<Link href="/services" className={marketing.textLink}>Clear filters</Link>}>
            Try a broader search or another category.
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <ul className={`${s.grid} ${s.grid3}`}>
            {data.items.map((svc) => (
              <li key={svc.id}>
                <article className={s.card}>
                  <div className={s.cardMeta}>
                    <span className={s.pill}>{svc.category}</span>
                    <span>from {svc.fromDays} day{svc.fromDays === 1 ? '' : 's'}</span>
                  </div>
                  <h3 className={s.cardTitle}>{svc.title}</h3>
                  <p className={s.cardText}>{svc.summary}</p>
                  <div className={s.cardFoot}>
                    <span className={s.muted}>
                      by <b>{svc.expertName}</b>
                      {svc.reviewCount > 0 && ` · ★ ${svc.rating.toFixed(1)} (${svc.reviewCount})`}
                    </span>
                    <span className={`${s.pill} ${s.pillMint}`}>from {inr(svc.fromPrice)}</span>
                  </div>
                  <Link href="/platform/services" className={marketing.textLink}>
                    View packages<span className={s.srOnlyInline}> for {svc.title}</span> →
                  </Link>
                </article>
              </li>
            ))}
          </ul>
        )}

        {data && pages > 1 && (
          <nav className={s.pager} aria-label="Pagination">
            {f.page > 1 && <Link href={pageHref(f.page - 1)} className={`${marketing.btn} ${marketing.btnSm}`}>← Previous</Link>}
            <span className={s.muted}>Page {f.page} of {pages}</span>
            {f.page < pages && <Link href={pageHref(f.page + 1)} className={`${marketing.btn} ${marketing.btnSm}`}>Next →</Link>}
          </nav>
        )}
      </section>
    </PageShell>
  );
}
