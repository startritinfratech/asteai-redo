import type { Metadata } from 'next';
import Link from 'next/link';
import { CASE_STUDIES } from '@/features/content';
import { PageHero, PageShell } from '@/features/marketing/PageShell';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

const description = 'How companies hire and deliver faster with ASTEAI’s pre-assessed experts and milestone-protected engagements.';

export const metadata: Metadata = {
  title: 'Case Studies',
  description,
  alternates: { canonical: '/case-studies' },
};

export default function CaseStudiesPage() {
  return (
    <PageShell>
      <PageHero eyebrow="Customer stories" title="Case Studies">
        {description}
      </PageHero>
      <section className={`${marketing.container} ${s.listSection}`} aria-label="Case studies">
        <ul className={`${s.grid} ${s.grid3}`}>
          {CASE_STUDIES.map((c) => (
            <li key={c.slug}>
              <Link href={`/case-studies/${c.slug}`} className={s.cardLink}>
                <article className={s.card}>
                  <span className={s.pill}>{c.industry}</span>
                  <h2 className={s.cardTitle}>{c.title}</h2>
                  <p className={s.cardText}>{c.excerpt}</p>
                  {c.results[0] && (
                    <p className={s.cardMeta}>
                      <strong className={s.pill + ' ' + s.pillMint}>{c.results[0].metric}</strong>
                      <span>{c.results[0].label}</span>
                    </p>
                  )}
                  <div className={`${s.cardMeta} ${s.cardFoot}`}>
                    <span>{c.client}</span>
                    <span>{c.readTime} min read</span>
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
