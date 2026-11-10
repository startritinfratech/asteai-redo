'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { verifyEmail } from '@/features/account/api';
import { useAuthStore } from '@/store/auth';
import { Spinner } from '../_components/shared';
import styles from '../auth.module.css';

type State = 'verifying' | 'done' | 'invalid' | 'error';

export function VerifyEmail() {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<State>(token ? 'verifying' : 'invalid');
  const started = useRef(false);

  useEffect(() => {
    // The token is single-use: send it once, even if the effect runs twice in development.
    if (!token || started.current) return;
    started.current = true;
    verifyEmail(token)
      .then(() => {
        setState('done');
        if (useAuthStore.getState().user) void useAuthStore.getState().refreshUser();
      })
      .catch((err: unknown) => setState(err instanceof ApiError && err.status === 400 ? 'invalid' : 'error'));
  }, [token]);

  return (
    <div className={styles.card} aria-live="polite">
      {state === 'verifying' && (
        <div>
          <h1 className={styles.title}>Confirming your email…</h1>
          <p className={styles.subtitle}><Spinner /> One moment.</p>
        </div>
      )}
      {state === 'done' && (
        <>
          <div>
            <h1 className={styles.title}>Email confirmed</h1>
            <p className={styles.subtitle}>Thanks, your email address is verified.</p>
          </div>
          <Link href="/platform" className={styles.submit}>Continue to AsteAI</Link>
        </>
      )}
      {state === 'invalid' && (
        <>
          <div>
            <h1 className={styles.title}>This link doesn’t work</h1>
            <p className={styles.subtitle}>
              It may have expired (links last 24 hours) or already been used. Sign in and send a new one from
              Security settings.
            </p>
          </div>
          <Link href="/platform/security" className={styles.submit}>Go to Security settings</Link>
        </>
      )}
      {state === 'error' && (
        <div>
          <h1 className={styles.title}>Something went wrong</h1>
          <p className={styles.subtitle}>We couldn’t confirm your email just now. Reload the page to try again.</p>
        </div>
      )}
    </div>
  );
}
