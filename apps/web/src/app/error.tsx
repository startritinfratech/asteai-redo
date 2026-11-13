'use client';

import Link from 'next/link';
import { useEffect } from 'react';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';

/** Route-level error boundary for everything under the root layout. */
export default function RouteError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <main id="main" className={`${marketing.container} ${s.centered}`}>
      <span className={s.bigCode}>Error</span>
      <h1 className={marketing.h2}>Something went wrong</h1>
      <p className={s.muted}>
        Please try again. If it keeps happening, contact support{error.digest ? ` and quote reference ${error.digest}` : ''}.
      </p>
      <div className={s.ctaRow}>
        <button type="button" onClick={reset} className={`${marketing.btn} ${marketing.btnPrimary}`}>Try again</button>
        <Link href="/" className={marketing.btn}>Go home</Link>
      </div>
    </main>
  );
}
