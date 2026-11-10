'use client';

import { useState } from 'react';
import { ApiError, errorMessage } from '@/lib/api';
import styles from '../auth.module.css';

/** Password input with a show/hide toggle. */
export function PasswordInput({
  id,
  value,
  onChange,
  autoComplete,
  invalid,
  describedBy,
}: {
  id: string;
  value: string;
  onChange: (value: string) => void;
  autoComplete: 'current-password' | 'new-password';
  invalid?: boolean;
  describedBy?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className={styles.passwordWrap}>
      <input
        id={id}
        name="password"
        type={visible ? 'text' : 'password'}
        className={styles.input}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        required
      />
      <button
        type="button"
        className={styles.reveal}
        onClick={() => setVisible((v) => !v)}
        aria-controls={id}
        aria-label={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? 'Hide' : 'Show'}
      </button>
    </div>
  );
}

export function Spinner() {
  return <span className={styles.spinner} aria-hidden="true" />;
}

export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Turns an auth API failure into a sentence a person can act on. */
export function authErrorMessage(err: unknown, fallback: string): string {
  if (err instanceof ApiError) {
    if (err.status === 401) return 'That email and password don’t match an account. Check them and try again.';
    if (err.status === 409) return 'An account with this email already exists.';
    if (err.status === 429) return 'Too many attempts. Please wait a minute, then try again.';
    if (err.status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
    return err.message || fallback;
  }
  if (err instanceof TypeError) return 'We couldn’t reach AsteAI. Check your connection and try again.';
  return errorMessage(err, fallback);
}
