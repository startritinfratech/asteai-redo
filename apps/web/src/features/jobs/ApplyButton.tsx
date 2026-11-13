'use client';

/**
 * Apply on a public job page. Signed out: create a candidate account, then come back here
 * (`next`). Signed in as a candidate: one click (the API is idempotent, so a second click
 * just confirms the existing application). Other roles are told why they can't apply.
 */
import Link from 'next/link';
import { useRef, useState } from 'react';
import type { Application } from '@asteai/types';
import { api, ApiError, errorMessage } from '@/lib/api';
import { LOGIN_PATH } from '@/lib/routes';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import marketing from '@/features/marketing/marketing.module.css';
import f from '@/features/public-forms/forms.module.css';

export function ApplyButton({ jobId, jobTitle }: { jobId: string; jobTitle: string }) {
  const hydrated = useAuthHydrated();
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<'idle' | 'pending' | 'done' | 'error'>('idle');
  const [error, setError] = useState('');
  const statusRef = useRef<HTMLDivElement>(null);
  const here = `/jobs/${encodeURIComponent(jobId)}`;

  if (!hydrated || !user) {
    return (
      <div className={marketing.ctaRow} style={{ marginTop: 0 }}>
        <Link href={`/auth/register?role=Candidate&next=${encodeURIComponent(here)}`} className={`${marketing.btn} ${marketing.btnPrimary}`}>
          Apply now
        </Link>
        <Link href={`${LOGIN_PATH}?next=${encodeURIComponent(here)}`} className={marketing.btn}>I have an account</Link>
      </div>
    );
  }

  if (user.role !== 'Candidate') {
    return (
      <p className={marketing.cardText} role="note">
        You’re signed in as {user.role === 'Admin' ? 'an' : 'a'} {user.role.toLowerCase()}. Applications need a candidate account.
      </p>
    );
  }

  if (state === 'done') {
    return (
      <div ref={statusRef} className={f.success} role="status" tabIndex={-1}>
        <strong>You’ve applied for {jobTitle}.</strong>
        <p className={marketing.cardText}>The employer may invite you to an assessment or AI interview; watch your email for deadlines.</p>
        <Link href="/platform/applications" className={marketing.textLink}>Track it in My applications →</Link>
      </div>
    );
  }

  return (
    <div style={{ display: 'grid', gap: 10, justifyItems: 'start' }}>
      {state === 'error' && <div ref={statusRef} className={f.alert} role="alert" tabIndex={-1}>{error}</div>}
      <button
        type="button"
        className={`${marketing.btn} ${marketing.btnPrimary}`}
        disabled={state === 'pending'}
        aria-busy={state === 'pending'}
        onClick={async () => {
          setState('pending');
          try {
            await api.post<Application>(`/applications/${encodeURIComponent(jobId)}/apply`);
            setState('done');
          } catch (err) {
            setError(err instanceof ApiError && err.status === 404
              ? 'This role is no longer accepting applications.'
              : errorMessage(err, 'We couldn’t submit your application. Please try again.'));
            setState('error');
          }
          requestAnimationFrame(() => statusRef.current?.focus());
        }}
      >
        {state === 'pending' ? 'Applying…' : 'Apply now'}
      </button>
    </div>
  );
}
