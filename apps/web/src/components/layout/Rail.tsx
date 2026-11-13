'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { clsx } from 'clsx';
import type { UserRole } from '@asteai/types';
import { NAV } from '@/lib/routes';
import styles from './Rail.module.css';

interface Props {
  role?: UserRole;
}

export function Rail({ role }: Props) {
  const pathname = usePathname();
  const sections = role ? NAV[role] : [];

  return (
    <nav className={styles.rail} aria-label="Main">
      {sections.map(([group, items]) => (
        <div key={group}>
          <div className={styles.group}>{group}</div>
          {items.map(({ slug, label, ready }) => {
            if (!ready) {
              return (
                <span key={slug} className={clsx(styles.link, styles.soon)} aria-disabled="true">
                  {label}
                  <span className={styles.soonTag}>Soon</span>
                </span>
              );
            }
            const href = `/platform/${slug}`;
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <Link
                key={slug}
                href={href}
                className={clsx(styles.link, active && styles.active)}
                aria-current={active ? 'page' : undefined}
              >
                {label}
              </Link>
            );
          })}
        </div>
      ))}
    </nav>
  );
}
