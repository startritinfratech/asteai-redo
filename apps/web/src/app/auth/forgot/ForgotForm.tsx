'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { requestPasswordReset } from '@/features/account/api';
import { EMAIL_RE, Spinner, authErrorMessage } from '../_components/shared';
import styles from '../auth.module.css';

export function ForgotForm() {
  const id = useId();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState(false);
  const emailRef = useRef<HTMLInputElement>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const value = email.trim();
    const problem = !value
      ? 'Enter your email address.'
      : !EMAIL_RE.test(value) ? 'Enter a valid email address, like name@company.com.' : '';
    setError(problem);
    if (problem) {
      emailRef.current?.focus();
      return;
    }

    setPending(true);
    try {
      await requestPasswordReset(value);
      setSent(true);
    } catch (err) {
      setFormError(authErrorMessage(err, 'We couldn’t send the email. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  if (sent) {
    return (
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>Check your email</h1>
          <p className={styles.subtitle} role="status">
            If an account exists for {email.trim()}, we’ve emailed a link to reset your password. The link works
            once and expires in 30 minutes.
          </p>
        </div>
        <p className={styles.hint}>Didn’t get it? Check your spam folder, or wait a minute and try again.</p>
        <p className={styles.switch}>
          <Link href="/auth/login">Back to sign in</Link>
        </p>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div>
        <h1 className={styles.title}>Forgot your password?</h1>
        <p className={styles.subtitle}>
          Enter the email you use for AsteAI and we’ll send you a link to choose a new one.
        </p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {formError && <div className={styles.alert} role="alert">{formError}</div>}
        <div className={styles.field}>
          <label htmlFor={`${id}-email`} className={styles.label}>Email</label>
          <input
            id={`${id}-email`}
            ref={emailRef}
            name="email"
            type="email"
            inputMode="email"
            className={styles.input}
            value={email}
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) setError('');
            }}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? `${id}-email-error` : undefined}
            required
          />
          {error && <p id={`${id}-email-error`} className={styles.fieldError}>{error}</p>}
        </div>
        <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Sending…' : 'Email me a reset link'}
        </button>
      </form>

      <p className={styles.switch}>
        Remembered it? <Link href="/auth/login">Sign in</Link>
      </p>
    </div>
  );
}
