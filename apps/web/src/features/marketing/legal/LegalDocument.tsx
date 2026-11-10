import type { Metadata } from 'next';
import Link from 'next/link';
import { PageHero, PageShell } from '../PageShell';
import marketing from '../marketing.module.css';
import { LEGAL_SOURCES } from './content';
import { getLegalDoc, LEGAL_DOCS, type LegalSlug } from './documents';
import { parseHeader, renderMarkdown } from './markdown';
import styles from './legal.module.css';

/** Per-page metadata for a legal document route. */
export function legalMetadata(slug: LegalSlug): Metadata {
  const doc = getLegalDoc(slug);
  return {
    title: doc.navLabel,
    description: doc.summary,
    alternates: { canonical: `/legal/${slug}` },
  };
}

/** A full legal page: title, last-updated line, table of contents and the document body. */
export function LegalDocument({ slug }: { slug: LegalSlug }) {
  const doc = getLegalDoc(slug);
  const parsed = parseHeader(LEGAL_SOURCES[slug]);
  const lastUpdated = parsed.lastUpdated || doc.lastUpdated;
  const { body, toc } = renderMarkdown(parsed.body);
  const others = LEGAL_DOCS.filter((d) => d.slug !== slug);

  return (
    <PageShell>
      <PageHero
        eyebrow="Legal"
        title={doc.title}
        meta={
          <>
            <Link href="/legal" className={marketing.textLink}>All legal documents</Link>
            {lastUpdated && <span>Last updated: {lastUpdated}</span>}
            {parsed.version && <span>Version {parsed.version}</span>}
          </>
        }
      />

      <div className={`${marketing.container} ${styles.layout}`}>
        {toc.length > 2 && (
          <nav className={styles.toc} aria-labelledby="toc-title">
            <h2 id="toc-title" className={styles.tocTitle}>Contents</h2>
            <ol className={styles.tocList}>
              {toc.map((t) => (
                <li key={t.id}>
                  <a href={`#${t.id}`} className={styles.tocLink}>{t.label}</a>
                </li>
              ))}
            </ol>
          </nav>
        )}

        <article className={styles.prose} aria-labelledby="page-title">
          {body}
          {toc.length > 2 && (
            <p className={styles.backTop}>
              <a href="#toc-title" className={marketing.textLink}>Back to contents</a>
            </p>
          )}
        </article>
      </div>

      <nav className={`${marketing.container} ${styles.related}`} aria-labelledby="related-title">
        <h2 id="related-title" className={styles.relatedTitle}>Other legal documents</h2>
        <ul className={styles.relatedList}>
          {others.map((d) => (
            <li key={d.slug}>
              <Link href={`/legal/${d.slug}`} className={marketing.footerLink}>{d.navLabel}</Link>
            </li>
          ))}
        </ul>
      </nav>
    </PageShell>
  );
}
