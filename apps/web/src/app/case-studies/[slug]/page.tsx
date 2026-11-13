import type { Metadata } from 'next';
import { shareMeta } from '@/features/marketing/shareMeta';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CASE_STUDIES, formatPublished, getCaseStudy } from '@/features/content';
import { JsonLd } from '@/features/marketing/JsonLd';
import { breadcrumbLd } from '@/features/marketing/structuredData';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import { renderMarkdown } from '@/features/marketing/legal/markdown';
import legal from '@/features/marketing/legal/legal.module.css';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

export const dynamicParams = false;

export function generateStaticParams() {
  return CASE_STUDIES.map((c) => ({ slug: c.slug }));
}

export function generateMetadata({ params }: { params: { slug: string } }): Metadata {
  const c = getCaseStudy(params.slug);
  if (!c) return {};
  return {
    title: c.title,
    description: c.excerpt,
    alternates: { canonical: `/case-studies/${c.slug}` },
    ...shareMeta({ title: c.title, description: c.excerpt, type: 'article', publishedTime: c.publishedAt }),
  };
}

export default function CaseStudyPage({ params }: { params: { slug: string } }) {
  const c = getCaseStudy(params.slug);
  if (!c) notFound();
  const { body } = renderMarkdown(c.content);

  return (
    <PageShell>
      <JsonLd
        data={{
          '@context': 'https://schema.org',
          '@type': 'Article',
          headline: c.title,
          description: c.excerpt,
          datePublished: c.publishedAt,
          publisher: { '@type': 'Organization', name: 'ASTEAI' },
          about: c.industry,
        }}
      />
      <JsonLd data={breadcrumbLd([{ name: 'Case studies', path: '/case-studies' }, { name: c.title, path: `/case-studies/${c.slug}` }])} />
      <PageHero
        eyebrow={`Case study · ${c.industry}`}
        title={c.title}
        meta={
          <>
            <span>{c.client}</span>
            <time dateTime={c.publishedAt}>{formatPublished(c.publishedAt)}</time>
            <span>{c.readTime} min read</span>
          </>
        }
      />
      <div className={marketing.container}>
        <div className={s.article}>
          <ul className={s.stats} aria-label="Results">
            {c.results.map((r) => (
              <li key={r.label} className={s.stat}>
                <div className={s.statValue}>{r.metric}</div>
                <div className={s.statLabel}>{r.label}</div>
              </li>
            ))}
          </ul>
          <dl className={s.articleMeta} style={{ marginTop: 16 }}>
            <dt>Expert domain:</dt><dd style={{ margin: 0 }}>{c.expertDomain}</dd>
            <dt>Engagement:</dt><dd style={{ margin: 0 }}>{c.engagementModel}</dd>
          </dl>
          <article className={legal.prose} aria-labelledby="page-title" style={{ marginTop: 32 }}>
            {body}
          </article>
          <footer className={s.articleFoot}>
            <Link href="/case-studies" className={marketing.textLink}>← All case studies</Link>
          </footer>
        </div>
      </div>
    </PageShell>
  );
}
