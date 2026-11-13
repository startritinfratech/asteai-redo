'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Empty, PageHeader } from '@/components/ui';
import { ExpertCardView, ExpertFiltersForm, Pager } from '@/features/profiles/ExpertDirectory';
import { filtersToQuery, parseFilters } from '@/features/profiles/format';
import type { ExpertPage } from '@/features/profiles/types';
import styles from '@/features/profiles/profiles.module.css';

const BASE_PATH = '/platform/experts';
const PAGE_SIZE = 12;

/**
 * In-app expert search: the public directory (GET /experts, approved profiles only, no
 * emails) with the same filters, kept in the URL. Cards open the public profile.
 */
export default function ExpertsPage({ searchParams }: { searchParams: Record<string, string | string[] | undefined> }) {
  const filters = parseFilters(searchParams);
  const query = filtersToQuery(filters);
  const key = `/experts${query ? `${query}&` : '?'}pageSize=${PAGE_SIZE}`;
  const { data, error, isLoading } = useSWR<ExpertPage>(key, fetcher, { keepPreviousData: true });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
      <PageHeader
        eyebrow="Talent Sourcing"
        title="Find Experts"
        sub="Search reviewed deep-tech experts by skill, domain, rate and availability. Look for the Talent Passport badge for verified assessment results."
      />

      <div className={styles.directory} style={{ paddingBlock: 0 }}>
        <ExpertFiltersForm key={query} filters={filters} basePath={BASE_PATH} />
        <section aria-labelledby="experts-results-h">
          <div className={styles.resultsHead}>
            <h2 id="experts-results-h" className={styles.muted} aria-live="polite">
              {data ? `${data.total} expert${data.total === 1 ? '' : 's'}` : 'Experts'}
            </h2>
          </div>
          {isLoading && !data && <Empty message="Loading experts…" />}
          {error && <div className={styles.emptyBox} role="alert">Could not load the expert directory. Please try again shortly.</div>}
          {data && data.items.length === 0 && (
            <div className={styles.emptyBox}>No experts match these filters yet. Try a broader search.</div>
          )}
          {data && data.items.length > 0 && (
            <>
              <ul className={styles.cards}>
                {data.items.map((e) => <li key={e.userId}><ExpertCardView expert={e} /></li>)}
              </ul>
              <Pager filters={filters} page={data.page} pageSize={data.pageSize} total={data.total} basePath={BASE_PATH} />
            </>
          )}
          <p style={{ margin: '14px 0 0', fontSize: '0.8rem', color: 'var(--fg-3)' }}>
            Inviting an expert to a project is coming soon. For now, publish a project and experts can bid on it.
          </p>
        </section>
      </div>
    </div>
  );
}
