'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { LOGIN_PATH } from '@/lib/routes';
import { hasSessionHint } from '@/lib/tokens';
import { VoiceAssistant } from '@/features/voice-assistant';
import { Rail } from './Rail';
import { TopBar } from './TopBar';
import styles from './AppShell.module.css';

/**
 * Shell for every authenticated page. Waits for the persisted session to load, then
 * sends signed-out visitors to the login page (remembering where they were going).
 *
 * The session lives in HttpOnly cookies, so the cached user can be missing while the
 * session is fine (signed in from another tab, or via Google / GitHub). When the session
 * hint cookie is there, the user is loaded once from the API before deciding.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const hydrated = useAuthHydrated();
  const user = useAuthStore((s) => s.user);
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    if (!hydrated || user || checked) return;
    if (!hasSessionHint()) {
      setChecked(true);
      return;
    }
    void refreshUser().finally(() => setChecked(true));
  }, [hydrated, user, checked, refreshUser]);

  useEffect(() => {
    if (hydrated && checked && !user) {
      // Keep the query string too (e.g. ?id=…); read it here rather than through
      // useSearchParams so the shell does not need a Suspense boundary.
      const search = typeof window !== 'undefined' ? window.location.search : '';
      router.replace(`${LOGIN_PATH}?next=${encodeURIComponent(`${pathname}${search}`)}`);
    }
  }, [hydrated, checked, user, pathname, router]);

  if (!hydrated || !user) {
    return <div className={styles.loading}>Loading…</div>;
  }

  return (
    <div className={styles.root}>
      <TopBar user={user} />
      <div className={styles.shell}>
        <Rail role={user.role} />
        <main className={styles.main}>{children}</main>
      </div>
      <VoiceAssistant role={user.role} />
    </div>
  );
}
