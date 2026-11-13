import type { Metadata } from 'next';
import { shareMeta } from '@/features/marketing/shareMeta';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { EMPLOYMENT_TYPE_LABEL, formatSalary, LOCATION_TYPE_LABEL, type PublicJob } from '@/features/jobs/types';
import { ApplyButton } from '@/features/jobs/ApplyButton';
import { JsonLd } from '@/features/marketing/JsonLd';
import { breadcrumbLd } from '@/features/marketing/structuredData';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { ApiNotFound, ApiUnavailable, serverGet } from '@/lib/serverApi';

const UUIDISH = /^[0-9a-zA-Z-]{1,64}$/;

/** null = the API is unavailable; notFound() for unknown or unpublished jobs. */
async function loadJob(id: string): Promise<PublicJob | null> {
  if (!UUIDISH.test(id)) notFound();
  try {
    return await serverGet<PublicJob>(`/jobs/public/${encodeURIComponent(id)}`);
  } catch (err) {
    if (err instanceof ApiNotFound) notFound();
    if (err instanceof ApiUnavailable) return null;
    throw err;
  }
}

export async function generateMetadata({ params }: { params: { id: string } }): Promise<Metadata> {
  const job = await loadJob(params.id);
  if (!job) return { title: 'Open role', robots: { index: false } };
  const description = `${job.title} at ${job.company.name} · ${LOCATION_TYPE_LABEL[job.locationType]}${job.location ? `, ${job.location}` : ''}. Apply on ASTEAI.`;
  return {
    title: `${job.title} at ${job.company.name}`,
    description,
    alternates: { canonical: `/jobs/${job.id}` },
    ...shareMeta({ title: `${job.title} at ${job.company.name}`, description, image: false }),
  };
}

export default async function JobDetailPage({ params }: { params: { id: string } }) {
  const job = await loadJob(params.id);

  if (!job) {
    return (
      <PageShell>
        <PageHero eyebrow="Open role" title="This role can’t be shown right now" />
        <div className={`${marketing.container} ${s.listSection}`}>
          <div className={s.notice} role="alert">
            <strong>The job board is temporarily unavailable.</strong> Please try again shortly.{' '}
            <Link href="/jobs" className={marketing.textLink}>Back to all roles</Link>
          </div>
        </div>
      </PageShell>
    );
  }

  const salary = formatSalary(job);
  const closed = job.expiresAt ? new Date(job.expiresAt) < new Date() : false;

  return (
    <PageShell>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'JobPosting',
          title: job.title,
          description: job.description,
          datePosted: job.createdAt,
          ...(job.expiresAt ? { validThrough: job.expiresAt } : {}),
          employmentType: job.employmentType.toUpperCase(),
          hiringOrganization: { '@type': 'Organization', name: job.company.name, ...(job.company.website ? { sameAs: job.company.website } : {}) },
          ...(job.locationType === 'remote'
            ? { jobLocationType: 'TELECOMMUTE' }
            : { jobLocation: { '@type': 'Place', address: job.location ?? undefined } }),
          ...(job.salaryMin != null || job.salaryMax != null
            ? {
                baseSalary: {
                  '@type': 'MonetaryAmount',
                  currency: job.salaryCurrency,
                  value: { '@type': 'QuantitativeValue', minValue: job.salaryMin ?? undefined, maxValue: job.salaryMax ?? undefined, unitText: 'YEAR' },
                },
              }
            : {}),
        }}
      />
      <JsonLd data={breadcrumbLd([{ name: 'Open roles', path: '/jobs' }, { name: job.title, path: `/jobs/${job.id}` }])} />
      <PageHero
        eyebrow={job.company.name}
        title={job.title}
        meta={
          <>
            <span>{LOCATION_TYPE_LABEL[job.locationType]}{job.location ? ` · ${job.location}` : ''}</span>
            <span>{EMPLOYMENT_TYPE_LABEL[job.employmentType]}</span>
            {salary && <span>{salary}</span>}
          </>
        }
      />
      <div className={marketing.container}>
        <div className={s.article}>
          {closed ? (
            <div className={s.notice}><strong>Applications for this role have closed.</strong></div>
          ) : (
            <ApplyButton jobId={job.id} jobTitle={job.title} />
          )}
          <section aria-labelledby="desc-h" style={{ marginTop: 32 }}>
            <h2 id="desc-h" className={s.sectionTitle}>About the role</h2>
            <p className={s.cardText} style={{ whiteSpace: 'pre-line' }}>{job.description}</p>
          </section>
          {job.requirements.length > 0 && (
            <section aria-labelledby="req-h" style={{ marginTop: 32 }}>
              <h2 id="req-h" className={s.sectionTitle}>Requirements</h2>
              <ul className={marketing.bullets}>
                {job.requirements.map((r) => <li key={r}><span aria-hidden="true">•</span>{r}</li>)}
              </ul>
            </section>
          )}
        </div>
      </div>
    </PageShell>
  );
}
