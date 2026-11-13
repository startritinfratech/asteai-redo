import Link from 'next/link';
import { SOCIAL_LINKS, type SocialId } from '@/lib/site';
import { NewsletterForm } from '../public-forms/NewsletterForm';
import { IsoBadge } from './IsoBadge';
import { LEGAL_DOCS } from './legal/documents';
import { Logo } from './Logo';
import { FOOTER_COLUMNS } from './nav';
import styles from './marketing.module.css';

const SOCIAL_ICON: Record<SocialId, string> = {
  x: 'M4 4l16 16M20 4L4 20',
  linkedin: 'M6 9v9M6 5.5v.5M10 18v-5a3 3 0 0 1 6 0v5M10 9v9',
  instagram: 'M7 3h10a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V7a4 4 0 0 1 4-4zM12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7zM17.5 6.5v.01',
  facebook: 'M14 8h3V4h-3a4 4 0 0 0-4 4v3H7v4h3v6h4v-6h3l1-4h-4V8z',
  youtube: 'M3 8a3 3 0 0 1 3-3h12a3 3 0 0 1 3 3v8a3 3 0 0 1-3 3H6a3 3 0 0 1-3-3V8zM10 9v6l5-3-5-3z',
};

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <Logo />
            <p className={styles.footerTagline}>
              Hiring, delivered. AI interviews, server-scored assessments, verifiable Talent Passports and
              escrow-protected projects.
            </p>
            <ul className={styles.socials} aria-label="ASTEAI on social media">
              {SOCIAL_LINKS.map((s) => (
                <li key={s.id}>
                  <a href={s.href} className={styles.social} target="_blank" rel="noopener noreferrer" aria-label={s.label}>
                    <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                      <path d={SOCIAL_ICON[s.id]} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </a>
                </li>
              ))}
            </ul>
            <NewsletterForm />
            <IsoBadge />
          </div>

          {FOOTER_COLUMNS.map((col) => (
            <nav key={col.id} aria-labelledby={`footer-${col.id}`}>
              <h2 id={`footer-${col.id}`} className={styles.footerHeading}>{col.heading}</h2>
              <ul className={styles.footerList}>
                {col.links.map((l) => (
                  <li key={l.href + l.label}>
                    <Link href={l.href} className={styles.footerLink}>{l.label}</Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>

        <nav aria-labelledby="footer-legal" className={styles.footerLegal}>
          <h2 id="footer-legal" className={styles.footerHeading}>Legal</h2>
          <ul className={styles.footerLegalList}>
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug}>
                <Link href={`/legal/${d.slug}`} className={styles.footerLink}>{d.navLabel}</Link>
              </li>
            ))}
            <li><Link href="/consent-preferences" className={styles.footerLink}>Consent preferences</Link></li>
          </ul>
        </nav>

        <p className={styles.footerBottom}>© {new Date().getFullYear()} ASTEAI. All rights reserved.</p>
      </div>
    </footer>
  );
}
