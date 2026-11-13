'use client';

import Link from 'next/link';
import { LOGIN_PATH } from '@/lib/routes';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import styles from './profiles.module.css';

/**
 * The call to action on a public profile. Signed-out visitors (and the first render,
 * so server and client markup match) get "Sign in"; a signed-in Buyer can message.
 */
export function ExpertActions({ expertId, expertName }: { expertId: string; expertName: string }) {
  const hydrated = useAuthHydrated();
  const user = useAuthStore((s) => s.user);
  const here = `/experts/${expertId}`;

  if (!hydrated || !user) {
    return (
      <div className={styles.cta}>
        <Link className={styles.ctaBtn} href={`${LOGIN_PATH}?next=${encodeURIComponent(here)}`}>
          Sign in to message or hire
        </Link>
        <p className={styles.muted}>Buyers can message {expertName} and invite them to projects.</p>
      </div>
    );
  }
  if (user.id === expertId) {
    return (
      <div className={styles.cta}>
        <Link className={`${styles.ctaBtn} ${styles.ctaGhost}`} href="/platform/profile">Edit my profile</Link>
      </div>
    );
  }
  if (user.role !== 'Buyer') {
    return <p className={styles.muted}>Only buyer accounts can message or hire experts.</p>;
  }
  return (
    <div className={styles.cta}>
      <Link className={styles.ctaBtn} href={`/platform/messages?with=${encodeURIComponent(expertId)}`}>
        Message {expertName}
      </Link>
      <button type="button" className={`${styles.ctaBtn} ${styles.ctaGhost}`} disabled aria-describedby="invite-note">
        Invite to project
      </button>
      <p id="invite-note" className={styles.muted}>
        Inviting an expert to a project is coming soon. For now, publish a project and experts can bid on it.
      </p>
    </div>
  );
}
