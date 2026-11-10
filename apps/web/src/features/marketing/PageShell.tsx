import type { ReactNode } from 'react';
import { SiteFooter } from './SiteFooter';
import { SiteHeader } from './SiteHeader';
import styles from './marketing.module.css';
import page from './pages.module.css';

/** Header + main landmark + footer, shared by every public page. */
export function PageShell({ children }: { children: ReactNode }) {
  return (
    <div className={styles.page}>
      <SiteHeader />
      <main id="main" tabIndex={-1} className={page.main}>
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}

/** The top of a public page: eyebrow, the page's only h1, and an optional lede. */
export function PageHero({ eyebrow, title, children, meta }: {
  eyebrow: string;
  title: string;
  children?: ReactNode;
  meta?: ReactNode;
}) {
  return (
    <section className={page.hero} aria-labelledby="page-title">
      <div className={styles.container}>
        <span className={styles.eyebrow}>{eyebrow}</span>
        <h1 id="page-title" className={page.title}>{title}</h1>
        {meta && <div className={page.meta}>{meta}</div>}
        {children && <p className={page.lede}>{children}</p>}
      </div>
    </section>
  );
}
