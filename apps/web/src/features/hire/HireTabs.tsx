'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import useSWR from 'swr';
import type { HiringKpis } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import { HIRE_KEYS } from './api';
import styles from './Hire.module.css';

const TABS = [
  { href: '/platform/hire', label: 'Overview', exact: true },
  { href: '/platform/hire/job-creator', label: 'AI Job Creator' },
  { href: '/platform/hire/pipeline', label: 'Pipeline' },
  { href: '/platform/hire/pools', label: 'Talent Pools' },
  { href: '/platform/hire/outreach', label: 'Outreach' },
] as const;

export function HireTabs() {
  const pathname = usePathname();
  const isAdmin = useAuthStore((s) => s.user?.role === 'Admin');
  const { data: kpis } = useSWR<HiringKpis | null>(isAdmin ? HIRE_KEYS.kpis : null, fetcher);
  const tabs = isAdmin ? [...TABS, { href: '/platform/hire/approvals', label: 'Approvals' }] : TABS;

  return (
    <nav className={styles.tabs} aria-label="Hire workspace">
      {tabs.map((t) => {
        const active = 'exact' in t && t.exact ? pathname === t.href : pathname === t.href || pathname.startsWith(`${t.href}/`);
        return (
          <Link key={t.href} href={t.href} className={active ? `${styles.tab} ${styles.tabActive}` : styles.tab} aria-current={active ? 'page' : undefined}>
            {t.label}
            {t.href.endsWith('approvals') && !!kpis?.pendingApproval && (
              <span className={styles.count} aria-label={`${kpis.pendingApproval} waiting`}>{kpis.pendingApproval}</span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
