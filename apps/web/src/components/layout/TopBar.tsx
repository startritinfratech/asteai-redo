'use client';

import Link from 'next/link';
import { useAuthStore } from '@/store/auth';
import type { User } from '@asteai/types';
import styles from './TopBar.module.css';

interface Props {
  user: User | null;
}

export function TopBar({ user }: Props) {
  const logout = useAuthStore((s) => s.logout);

  return (
    <header className={styles.top}>
      <div className={styles.inner}>
        <Link href="/platform" className={styles.logo}>
          <span className={styles.mark} />
          ASTEAI
        </Link>

        {user && (
          <span className={styles.ctx}>
            {user.title}{user.tenantId ? ` · ${user.tenantId}` : ''}
          </span>
        )}

        <div className={styles.who}>
          {user ? (
            <>
              <span className={styles.persona}>
                {user.firstName} {user.lastName} — {user.role}
              </span>
              <button className={styles.bell} title="Notifications" data-voice-ignore>🔔</button>
              <button className={styles.btn} onClick={logout}>Sign out</button>
            </>
          ) : (
            <Link href="/auth/login" className={styles.btn}>Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
