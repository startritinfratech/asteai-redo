'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import styles from './Career.module.css';

const TABS = [
  { href: '/platform/career', label: 'Command Center', exact: true },
  { href: '/platform/career/interview', label: 'AI Interview Studio' },
  { href: '/platform/career/challenges', label: 'Code Challenges' },
  { href: '/platform/career/resume', label: 'Résumé & Autofill' },
] as const;

export function CareerTabs() {
  const pathname = usePathname();
  return (
    <nav className={styles.tabs} aria-label="Career Studio">
      {TABS.map((t) => {
        const active = 'exact' in t ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab} aria-current={active ? 'page' : undefined}>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
