'use client';

import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import type { User } from '@asteai/types';
import { ApiError } from '@/lib/api';
import { loginSecondFactor } from '@/features/account/api';
import { useAuthStore } from '@/store/auth';
import { Spinner, authErrorMessage } from '../_components/shared';
import styles from '../auth.module.css';
import step from './step.module.css';

/**
 * Second sign-in step, shown by LoginForm when the password was right and the account
 * has two-factor authentication on. Trades the challenge plus a code for tokens.
 */
export function TwoFactorStep({
  challenge,
  onSignedIn,
  onCancel,
}: {
  challenge: string;
  onSignedIn: (user: User) => void;
  onCancel: () => void;
}) {
  const id = useId();
  const [useBackup, setUseBackup] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState('');
  const [expired, setExpired] = useState(false);
  const [pending, setPending] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, [useBackup]);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    const clean = useBackup ? value.trim() : value.replace(/\s/g, '');
    if (!useBackup && !/^\d{6}$/.test(clean)) {
      setError('Enter the 6-digit code from your authenticator app.');
      inputRef.current?.focus();
      return;
    }
    if (useBackup && clean.replace(/[^a-z0-9]/gi, '').length < 8) {
      setError('Enter one of your backup codes, like k7tq-3mzp-x9ad.');
      inputRef.current?.focus();
      return;
    }

    setPending(true);
    setError('');
    try {
      const res = await loginSecondFactor(challenge, useBackup ? { backupCode: clean } : { code: clean });
      // Keep the button busy while the next page loads.
      onSignedIn(useAuthStore.getState().setSession(res));
    } catch (err) {
      setPending(false);
      if (err instanceof ApiError && (err.status === 401 || err.status === 429)) {
        setExpired(/expired/i.test(err.message));
        setError(err.message);
      } else {
        setError(authErrorMessage(err, 'Sign-in failed. Please try again.'));
      }
      setValue('');
      inputRef.current?.focus();
    }
  }

  return (
    <div className={styles.card}>
      <div>
        <h1 className={styles.title}>Two-factor authentication</h1>
        <p className={styles.subtitle}>
          {useBackup
            ? 'Enter one of the backup codes you saved when you turned on two-factor authentication. Each code works once.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </div>

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {error && (
          <div className={styles.alert} role="alert">
            {error}
            {expired && (
              <>
                {' '}
                <button type="button" className={step.linkButton} onClick={onCancel}>Sign in again</button>
              </>
            )}
          </div>
        )}
        <div className={styles.field}>
          <label htmlFor={`${id}-code`} className={styles.label}>{useBackup ? 'Backup code' : 'Authentication code'}</label>
          <input
            id={`${id}-code`}
            ref={inputRef}
            name={useBackup ? 'backupCode' : 'code'}
            className={`${styles.input} ${step.codeInput}`}
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error && !expired) setError('');
            }}
            inputMode={useBackup ? 'text' : 'numeric'}
            pattern={useBackup ? undefined : '[0-9 ]*'}
            autoComplete="one-time-code"
            autoCapitalize="none"
            spellCheck={false}
            maxLength={useBackup ? 40 : 7}
            aria-invalid={error ? true : undefined}
            required
          />
        </div>
        <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Verifying…' : 'Verify and sign in'}
        </button>
      </form>

      <div className={step.stepActions}>
        <button
          type="button"
          className={step.linkButton}
          onClick={() => {
            setUseBackup((b) => !b);
            setValue('');
            setError('');
          }}
        >
          {useBackup ? 'Use your authenticator app instead' : 'Use a backup code'}
        </button>
        <button type="button" className={step.linkButton} onClick={onCancel}>
          Back to sign in
        </button>
      </div>
    </div>
  );
}
