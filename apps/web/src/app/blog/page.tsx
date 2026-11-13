import type { Metadata } from 'next';
import { shareMeta } from '@/features/marketing/shareMeta';
import Link from 'next/link';
import { formatPublished, POSTS } from '@/features/content';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

const description = 'Perspectives, engineering breakdowns and research on autonomous talent evaluation, workforce deployment and multi-modal assessment.';

export const metadata: Metadata = {
  title: { absolute: 'ASTEAI Journal — Insights on Technical Hiring, AI & Talent Systems' },
  description,
  alternates: { canonical: '/blog' },
  ...shareMeta({ title: 'ASTEAI Journal', description }),
};

export default function BlogIndexPage() {
  return (
    <PageShell>
      <PageHero eyebrow="ASTEAI Journal" title="Blog">
        {description}
      </PageHero>
      <section className={`${marketing.container} ${s.listSection}`} aria-label="Posts">
        <ul className={`${s.grid} ${s.grid3}`}>
          {POSTS.map((p) => (
            <li key={p.slug}>
              <Link href={`/blog/${p.slug}`} className={s.cardLink}>
                <article className={s.card}>
                  <span className={s.pill}>{p.category}</span>
                  <h2 className={s.cardTitle}>{p.title}</h2>
                  <p className={s.cardText}>{p.excerpt}</p>
                  <div className={`${s.cardMeta} ${s.cardFoot}`}>
                    <time dateTime={p.publishedAt}>{formatPublished(p.publishedAt)}</time>
                    <span>{p.readTime} min read</span>
                  </div>
                </article>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </PageShell>
  );
}
