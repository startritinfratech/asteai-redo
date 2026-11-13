import type { Metadata } from 'next';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import { ExpertCardView, ExpertFiltersForm, Pager } from '@/features/profiles/ExpertDirectory';
import { filtersToQuery, parseFilters } from '@/features/profiles/format';
import { DirectoryUnavailable, fetchExperts } from '@/features/profiles/server';
import type { ExpertPage } from '@/features/profiles/types';
import styles from '@/features/profiles/profiles.module.css';

type SearchParams = Record<string, string | string[] | undefined>;

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const f = parseFilters(searchParams);
  const topic = f.q || f.skill || f.domain;
  const filtered = Object.values(f).some((v) => v !== undefined);
  return {
    title: topic ? `${topic} experts` : 'Find deep-tech experts',
    description:
      'Browse vetted freelance experts in AI, robotics, semiconductors and more. Filter by skill, domain, rate and availability, and see Talent Passport holders.',
    alternates: { canonical: '/experts' },
    // Filtered and paged variants are useful to people, not to search indexes.
    robots: filtered ? { index: false, follow: true } : undefined,
  };
}

export default async function ExpertsPage({ searchParams }: { searchParams: SearchParams }) {
  const filters = parseFilters(searchParams);
  let result: ExpertPage | null = null;
  let failure: string | null = null;
  try {
    result = await fetchExperts(filters);
  } catch (err) {
    if (!(err instanceof DirectoryUnavailable)) throw err;
    failure = err.message;
  }

  return (
    <PageShell>
      <PageHero eyebrow="Expert directory" title="Find deep-tech experts">
        Every expert here was reviewed by our team. Look for the Talent Passport badge for verified assessment results.
      </PageHero>
      <div className={marketing.container}>
        <div className={styles.directory}>
          <ExpertFiltersForm filters={filters} />
          <section aria-labelledby="results-h">
            <div className={styles.resultsHead}>
              <h2 id="results-h" className={styles.muted} aria-live="polite">
                {result ? `${result.total} expert${result.total === 1 ? '' : 's'}` : 'Experts'}
              </h2>
              {filtersToQuery({ ...filters, page: undefined }) && <a href="/experts" className={styles.muted}>Clear filters</a>}
            </div>
            {failure && <div className={styles.emptyBox} role="alert">{failure} Please try again shortly.</div>}
            {result && result.items.length === 0 && (
              <div className={styles.emptyBox}>No experts match these filters yet. Try a broader search.</div>
            )}
            {result && result.items.length > 0 && (
              <>
                <ul className={styles.cards}>
                  {result.items.map((e) => <li key={e.userId}><ExpertCardView expert={e} /></li>)}
                </ul>
                <Pager filters={filters} page={result.page} pageSize={result.pageSize} total={result.total} />
              </>
            )}
          </section>
        </div>
      </div>
    </PageShell>
  );
}
