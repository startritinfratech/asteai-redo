import Link from 'next/link';
import { LOGIN_PATH } from '@/lib/routes';
import { REGISTER_PATH } from './AuthAwareActions';
import { LEGAL_DOCS } from './legal/documents';
import { Logo } from './Logo';
import { PAGE_LINKS, SECTION_LINKS } from './SiteHeader';
import styles from './marketing.module.css';

const COMPANY_LINKS = [
  { href: '/about', label: 'About us' },
  { href: '/contact', label: 'Contact' },
  { href: '/legal', label: 'Legal' },
] as const;

export function SiteFooter() {
  return (
    <footer className={styles.footer}>
      <div className={styles.container}>
        <div className={styles.footerGrid}>
          <div className={styles.footerBrand}>
            <Logo />
            <p className={styles.footerTagline}>
              Hiring and expert work, decided on evidence: AI interviews, server-scored assessments, verifiable
              Talent Passports and escrow-protected projects.
            </p>
          </div>

          <nav aria-labelledby="footer-product">
            <h2 id="footer-product" className={styles.footerHeading}>Product</h2>
            <ul className={styles.footerList}>
              {PAGE_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={styles.footerLink}>{l.label}</Link>
                </li>
              ))}
              {SECTION_LINKS.map((l) => (
                <li key={l.href}>
                  <a href={l.href} className={styles.footerLink}>{l.label}</a>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-company">
            <h2 id="footer-company" className={styles.footerHeading}>Company</h2>
            <ul className={styles.footerList}>
              {COMPANY_LINKS.map((l) => (
                <li key={l.href}>
                  <Link href={l.href} className={styles.footerLink}>{l.label}</Link>
                </li>
              ))}
            </ul>
          </nav>

          <nav aria-labelledby="footer-join">
            <h2 id="footer-join" className={styles.footerHeading}>Join</h2>
            <ul className={styles.footerList}>
              <li><Link href={`${REGISTER_PATH}?role=Employer`} className={styles.footerLink}>Hire talent</Link></li>
              <li><Link href={`${REGISTER_PATH}?role=Candidate`} className={styles.footerLink}>Get certified</Link></li>
              <li><Link href={`${REGISTER_PATH}?role=Freelancer`} className={styles.footerLink}>Work as an expert</Link></li>
              <li><Link href={`${REGISTER_PATH}?role=Buyer`} className={styles.footerLink}>Buy expertise</Link></li>
            </ul>
          </nav>

          <nav aria-labelledby="footer-account">
            <h2 id="footer-account" className={styles.footerHeading}>Account</h2>
            <ul className={styles.footerList}>
              <li><Link href={LOGIN_PATH} className={styles.footerLink}>Sign in</Link></li>
              <li><Link href={REGISTER_PATH} className={styles.footerLink}>Create an account</Link></li>
              <li><a href="/#passport" className={styles.footerLink}>Verify a certificate</a></li>
            </ul>
          </nav>
        </div>

        <nav aria-labelledby="footer-legal" className={styles.footerLegal}>
          <h2 id="footer-legal" className={styles.footerHeading}>Legal</h2>
          <ul className={styles.footerLegalList}>
            {LEGAL_DOCS.map((d) => (
              <li key={d.slug}>
                <Link href={`/legal/${d.slug}`} className={styles.footerLink}>{d.navLabel}</Link>
              </li>
            ))}
          </ul>
        </nav>

        <p className={styles.footerBottom}>© {new Date().getFullYear()} AsteAI. All rights reserved.</p>
      </div>
    </footer>
  );
}
