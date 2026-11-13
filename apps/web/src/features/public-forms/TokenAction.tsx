'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import marketing from '@/features/marketing/marketing.module.css';
import s from '@/features/marketing/public.module.css';
import { formErrorMessage } from './api';
import f from './forms.module.css';

/**
 * A page that acts on an emailed `?token=` (newsletter confirm / unsubscribe). It asks
 * before acting rather than on load, so link scanners that prefetch email links can't
 * confirm or unsubscribe someone by accident.
 */
export function TokenAction({ action, cta, done, run }: {
  action: string;
  cta: string;
  done: { title: string; body: string };
  run: (token: string) => Promise<unknown>;
}) {
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const resultRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state === 'done' || state === 'error') resultRef.current?.focus();
  }, [state]);

  if (!token) {
    return <div className={s.notice} role="alert"><strong>This link is incomplete.</strong> Open the link from your email again.</div>;
  }
  if (state === 'done') {
    return (
      <div ref={resultRef} className={f.success} role="status" tabIndex={-1}>
        <h2 className={f.successTitle}>{done.title}</h2>
        <p className={marketing.cardText}>{done.body}</p>
        <Link href="/" className={marketing.textLink}>Back to ASTEAI</Link>
      </div>
    );
  }
  return (
    <div className={s.ctaRow} style={{ flexDirection: 'column', alignItems: 'flex-start' }}>
      <p className={marketing.cardText}>{action}</p>
      {state === 'error' && <div ref={resultRef} className={f.alert} role="alert" tabIndex={-1}>{error}</div>}
      <button
        type="button"
        className={`${marketing.btn} ${marketing.btnPrimary}`}
        disabled={state === 'pending'}
        aria-busy={state === 'pending'}
        onClick={async () => {
          setState('pending');
          try {
            await run(token);
            setState('done');
          } catch (err) {
            setError(formErrorMessage(err));
            setState('error');
          }
        }}
      >
        {state === 'pending' ? 'Working…' : cta}
      </button>
    </div>
  );
}
