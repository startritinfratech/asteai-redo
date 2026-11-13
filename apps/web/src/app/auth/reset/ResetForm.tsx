'use client';

import Link from 'next/link';
import { useId, useState, type FormEvent } from 'react';
import { useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { resetPassword } from '@/features/account/api';
import { PASSWORD_MIN_LENGTH } from '@/features/account/types';
import { PasswordInput, Spinner, authErrorMessage } from '../_components/shared';
import styles from '../auth.module.css';

type Errors = { password?: string; confirm?: string };

export function ResetForm() {
  const token = useSearchParams().get('token') ?? '';
  const id = useId();
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [linkInvalid, setLinkInvalid] = useState(!token);
  const [pending, setPending] = useState(false);
  const [done, setDone] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const found: Errors = {};
    if (password.length < PASSWORD_MIN_LENGTH) found.password = `Use at least ${PASSWORD_MIN_LENGTH} characters.`;
    if (confirm !== password) found.confirm = 'The passwords don’t match.';
    setErrors(found);
    if (found.password || found.confirm) {
      document.getElementById(`${id}-${found.password ? 'password' : 'confirm'}`)?.focus();
      return;
    }

    setPending(true);
    try {
      await resetPassword(token, password);
      setDone(true);
    } catch (err) {
      // A 400 that isn't about the password means the link is unknown, used or expired.
      if (err instanceof ApiError && err.status === 400 && !/password/i.test(err.message)) setLinkInvalid(true);
      else setFormError(authErrorMessage(err, 'We couldn’t reset your password. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  if (done) {
    return (
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>Password changed</h1>
          <p className={styles.subtitle} role="status">
            Your new password is set, and you’ve been signed out on every device.
          </p>
        </div>
        <Link href="/auth/login" className={styles.submit}>Sign in</Link>
      </div>
    );
  }

  if (linkInvalid) {
    return (
      <div className={styles.card}>
        <div>
          <h1 className={styles.title}>This link doesn’t work</h1>
          <p className={styles.subtitle}>
            Reset links work once and expire after 30 minutes. Request a new one and use the most recent email.
          </p>
        </div>
        <Link href="/auth/forgot" className={styles.submit}>Request a new link</Link>
      </div>
    );
  }

  return (
    <div className={styles.card}>
      <div>
        <h1 className={styles.title}>Choose a new password</h1>
        <p className={styles.subtitle}>
          Use at least {PASSWORD_MIN_LENGTH} characters. Every device signed in to your account will be signed out.
        </p>
      </div>
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {formError && <div className={styles.alert} role="alert">{formError}</div>}
        <div className={styles.field}>
          <label htmlFor={`${id}-password`} className={styles.label}>New password</label>
          <PasswordInput
            id={`${id}-password`}
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
            }}
            autoComplete="new-password"
            invalid={!!errors.password}
            describedBy={errors.password ? `${id}-password-error` : undefined}
          />
          {errors.password && <p id={`${id}-password-error`} className={styles.fieldError}>{errors.password}</p>}
        </div>
        <div className={styles.field}>
          <label htmlFor={`${id}-confirm`} className={styles.label}>Confirm new password</label>
          <PasswordInput
            id={`${id}-confirm`}
            value={confirm}
            onChange={(v) => {
              setConfirm(v);
              if (errors.confirm) setErrors((x) => ({ ...x, confirm: undefined }));
            }}
            autoComplete="new-password"
            invalid={!!errors.confirm}
            describedBy={errors.confirm ? `${id}-confirm-error` : undefined}
          />
          {errors.confirm && <p id={`${id}-confirm-error`} className={styles.fieldError}>{errors.confirm}</p>}
        </div>
        <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Saving…' : 'Set new password'}
        </button>
      </form>
    </div>
  );
}
