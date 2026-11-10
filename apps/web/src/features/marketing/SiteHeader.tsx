import Link from 'next/link';
import { HeaderActions } from './AuthAwareActions';
import { Logo } from './Logo';
import styles from './marketing.module.css';

/** Landing-page sections. Root-relative so they work from every public page. */
export const SECTION_LINKS = [
  { href: '/#journeys', label: 'Who it’s for' },
  { href: '/#assessments', label: 'Assessments' },
  { href: '/#passport', label: 'Talent Passport' },
  { href: '/#ai', label: 'AI tools' },
  { href: '/#trust', label: 'Trust' },
] as const;

/** Standalone public pages. */
export const PAGE_LINKS = [
  { href: '/experts', label: 'Experts' },
  { href: '/how-it-works', label: 'How it works' },
  { href: '/pricing', label: 'Pricing' },
] as const;

/** What the header shows: the three key landing sections, then the standalone pages. */
const HEADER_LINKS = [
  { href: '/#journeys', label: 'Who it’s for', page: false },
  { href: '/#assessments', label: 'Assessments', page: false },
  { href: '/#passport', label: 'Talent Passport', page: false },
  ...PAGE_LINKS.map((l) => ({ ...l, page: true })),
];

/**
 * Sticky header. Navigation links show from 1040px up; on phones the header keeps just the
 * logo and the account actions (the same links are repeated in the footer).
 */
export function SiteHeader() {
  return (
    <header className={styles.header}>
      <a href="#main" className={styles.skip}>
        Skip to content
      </a>
      <div className={`${styles.container} ${styles.headerInner}`}>
        <Logo />
        <nav className={styles.nav} aria-label="Main">
          <ul className={styles.navList}>
            {HEADER_LINKS.map((l) => (
              <li key={l.href}>
                {l.page ? (
                  <Link href={l.href} className={styles.navLink}>{l.label}</Link>
                ) : (
                  <a href={l.href} className={styles.navLink}>{l.label}</a>
                )}
              </li>
            ))}
          </ul>
        </nav>
        <div className={styles.headerActions}>
          <HeaderActions />
        </div>
      </div>
    </header>
  );
}
