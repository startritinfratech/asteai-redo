'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { User } from '@asteai/types';
import { useAuthStore } from '@/store/auth';
import { LOGIN_PATH } from '@/lib/routes';
import { NotificationBell } from '@/features/notifications';
import styles from './TopBar.module.css';

interface Props {
  user: User | null;
}

export function TopBar({ user }: Props) {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);

  const signOut = async () => {
    await logout();
    router.replace(LOGIN_PATH);
  };

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
              <NotificationBell />
              <button type="button" className={styles.btn} onClick={signOut}>
                Sign out
              </button>
            </>
          ) : (
            <Link href={LOGIN_PATH} className={styles.btn}>Sign in</Link>
          )}
        </div>
      </div>
    </header>
  );
}
