import type { Metadata } from 'next';
import Link from 'next/link';
import { EmptyState } from '@/components/ui';
import {
  EMPLOYMENT_TYPE_LABEL, EMPLOYMENT_TYPES, formatSalary, LOCATION_TYPE_LABEL, LOCATION_TYPES,
  type EmploymentType, type LocationType, type PublicJobPage,
} from '@/features/jobs/types';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';

type SearchParams = Record<string, string | string[] | undefined>;
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? '';

function parse(sp: SearchParams) {
  const lt = one(sp.locationType) as LocationType;
  const et = one(sp.employmentType) as EmploymentType;
  return {
    q: one(sp.q).slice(0, 100),
    locationType: LOCATION_TYPES.includes(lt) ? lt : '',
    employmentType: EMPLOYMENT_TYPES.includes(et) ? et : '',
    cursor: one(sp.cursor).slice(0, 200),
  };
}

export function generateMetadata({ searchParams }: { searchParams: SearchParams }): Metadata {
  const f = parse(searchParams);
  return {
    title: { absolute: 'Explore Open Jobs — ASTEAI Verified Opportunities' },
    description: 'Browse technical, professional and frontline roles. Pre-assessed candidates get prioritised placement and fast-track interviews.',
    alternates: { canonical: '/jobs' },
    robots: f.q || f.locationType || f.employmentType || f.cursor ? { index: false, follow: true } : undefined,
  };
}

export default async function JobsPage({ searchParams }: { searchParams: SearchParams }) {
  const f = parse(searchParams);
  let data: PublicJobPage | null = null;
  let failed = false;
  try {
    data = await serverGet<PublicJobPage>('/jobs/public', {
      params: { limit: 20, q: f.q, locationType: f.locationType, employmentType: f.employmentType, cursor: f.cursor },
    });
  } catch (err) {
    if (!(err instanceof ApiUnavailable || err instanceof ApiNotFound)) throw err;
    failed = true;
  }
  const filtered = Boolean(f.q || f.locationType || f.employmentType);
  const nextHref = (cursor: string) => {
    const q = new URLSearchParams();
    if (f.q) q.set('q', f.q);
    if (f.locationType) q.set('locationType', f.locationType);
    if (f.employmentType) q.set('employmentType', f.employmentType);
    q.set('cursor', cursor);
    return `/jobs?${q}`;
  };

  return (
    <PageShell>
      <PageHero eyebrow="Open roles" title="Find your next role">
        Technical, professional and frontline openings from verified employers. Assessed candidates are prioritised for
        shortlists.
      </PageHero>
      <section className={`${marketing.container} ${s.listSection}`} aria-labelledby="results-h">
        <form className={s.filters} action="/jobs" method="get" role="search">
          <label className={s.control}>
            Search
            <input name="q" defaultValue={f.q} maxLength={100} placeholder="Title, skill or company" />
          </label>
          <label className={s.control}>
            Work mode
            <select name="locationType" defaultValue={f.locationType}>
              <option value="">Any</option>
              {LOCATION_TYPES.map((t) => <option key={t} value={t}>{LOCATION_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <label className={s.control}>
            Job type
            <select name="employmentType" defaultValue={f.employmentType}>
              <option value="">Any</option>
              {EMPLOYMENT_TYPES.map((t) => <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>)}
            </select>
          </label>
          <button type="submit" className={`${marketing.btn} ${marketing.btnPrimary}`}>Search</button>
        </form>

        <div className={s.listHead}>
          <h2 id="results-h" className={s.muted} aria-live="polite">
            {data ? `${data.total} open role${data.total === 1 ? '' : 's'}` : 'Open roles'}
          </h2>
          {filtered && <Link href="/jobs" className={marketing.textLink}>Clear filters</Link>}
        </div>

        {failed && (
          <div className={s.notice} role="alert">
            <strong>The job board is temporarily unavailable.</strong> Please check back shortly, or{' '}
            <Link href="/auth/register?role=Candidate" className={marketing.textLink}>create a candidate profile</Link> to be matched when roles open.
          </div>
        )}
        {data && data.items.length === 0 && (
          <EmptyState
            title={filtered ? 'No roles match these filters' : 'No open roles right now'}
            action={filtered ? <Link href="/jobs" className={marketing.textLink}>Clear filters</Link> : undefined}
          >
            {filtered ? 'Try a broader search.' : 'New roles are added regularly. Create a profile to be matched as soon as they open.'}
          </EmptyState>
        )}
        {data && data.items.length > 0 && (
          <ul className={s.grid}>
            {data.items.map((job) => {
              const salary = formatSalary(job);
              return (
                <li key={job.id}>
                  <Link href={`/jobs/${job.id}`} className={s.cardLink}>
                    <article className={s.card}>
                      <div className={s.cardMeta}>
                        <span>{job.company.name}</span>
                        {job.department && <span>{job.department}</span>}
                      </div>
                      <h3 className={s.cardTitle}>{job.title}</h3>
                      <div className={s.cardMeta}>
                        <span className={s.pill}>{LOCATION_TYPE_LABEL[job.locationType]}</span>
                        <span className={`${s.pill} ${s.pillGrey}`}>{EMPLOYMENT_TYPE_LABEL[job.employmentType]}</span>
                        {job.location && <span>{job.location}</span>}
                      </div>
                      <div className={`${s.cardMeta} ${s.cardFoot}`}>
                        {salary ? <span className={`${s.pill} ${s.pillMint}`}>{salary}</span> : <span />}
                        <time dateTime={job.createdAt}>
                          Posted {new Date(job.createdAt).toLocaleDateString('en-IN', { dateStyle: 'medium' })}
                        </time>
                      </div>
                    </article>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
        {data?.nextCursor && (
          <nav className={s.pager} aria-label="Pagination">
            <Link href={nextHref(data.nextCursor)} className={`${marketing.btn} ${marketing.btnSm}`}>More roles →</Link>
          </nav>
        )}
      </section>
    </PageShell>
  );
}
