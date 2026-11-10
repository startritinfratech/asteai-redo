'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { ROLE_HOME } from '@/lib/routes';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { isTwoFactorChallenge } from '@/features/account/api';
import { EMAIL_RE, PasswordInput, Spinner, authErrorMessage } from '../_components/shared';
import { TwoFactorStep } from '../2fa/TwoFactorStep';
import step from '../2fa/step.module.css';
import styles from '../auth.module.css';

/** Only same-site paths under /platform are honoured as a post-login destination. */
function safeNext(next: string | null): string | null {
  return next && next.startsWith('/platform') && !next.startsWith('//') ? next : null;
}

/** Seeded demo accounts. Shown in development, or when NEXT_PUBLIC_DEMO_LOGIN=true. */
const SHOW_DEMO = process.env.NODE_ENV !== 'production' || process.env.NEXT_PUBLIC_DEMO_LOGIN === 'true';
const DEMO_PASSWORD = 'Password123!';
const DEMO_ACCOUNTS = [
  { label: 'Admin', email: 'ops@asteai.com' },
  { label: 'Employer', email: 'priya@meridianhospitals.in' },
  { label: 'Candidate', email: 'rahul.g@gmail.com' },
  { label: 'Freelancer', email: 'aarav@dev.in' },
  { label: 'Buyer', email: 'nikhil@novastack.io' },
] as const;

type Errors = { email?: string; password?: string };

export function LoginForm() {
  const router = useRouter();
  const next = safeNext(useSearchParams().get('next'));
  const user = useAuthStore((s) => s.user);
  const login = useAuthStore((s) => s.login);
  const hydrated = useAuthHydrated();
  const id = useId();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [pending, setPending] = useState(false);
  const [badCredentials, setBadCredentials] = useState(false);
  /** Set when the password was right and the account has two-factor authentication on. */
  const [challenge, setChallenge] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const formErrorRef = useRef<HTMLDivElement>(null);

  function validate(): Errors {
    const e: Errors = {};
    if (!email.trim()) e.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address, like name@company.com.';
    if (!password) e.password = 'Enter your password.';
    return e;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    const found = validate();
    setErrors(found);
    if (found.email) return emailRef.current?.focus();
    if (found.password) return document.getElementById(`${id}-password`)?.focus();

    setPending(true);
    try {
      const signedIn = await login(email.trim(), password);
      if (isTwoFactorChallenge(signedIn)) {
        setPending(false);
        setPassword('');
        setChallenge(signedIn.challenge);
        return;
      }
      // Keep the button busy while the next page loads.
      router.replace(next ?? ROLE_HOME[signedIn.role]);
    } catch (err) {
      setPending(false);
      setBadCredentials(err instanceof ApiError && err.status === 401);
      setFormError(authErrorMessage(err, 'Sign-in failed. Please try again.'));
      requestAnimationFrame(() => formErrorRef.current?.focus());
    }
  }

  if (challenge) {
    return (
      <TwoFactorStep
        challenge={challenge}
        onSignedIn={(signedIn) => router.replace(next ?? ROLE_HOME[signedIn.role])}
        onCancel={() => setChallenge(null)}
      />
    );
  }

  return (
    <div className={styles.card}>
      <div>
        <h1 className={styles.title}>Sign in</h1>
        <p className={styles.subtitle}>Welcome back. Sign in to continue to your workspace.</p>
      </div>

      {hydrated && user && (
        <p className={styles.notice}>
          You&apos;re already signed in as {user.email}.{' '}
          <Link href={next ?? ROLE_HOME[user.role]}>Go to dashboard</Link>
        </p>
      )}

      {SHOW_DEMO && (
        <div className={styles.demo}>
          <span className={styles.demoLabel} id={`${id}-demo`}>Demo accounts · password {DEMO_PASSWORD}</span>
          <div className={styles.demoPills} role="group" aria-labelledby={`${id}-demo`}>
            {DEMO_ACCOUNTS.map((acc) => (
              <button
                key={acc.email}
                type="button"
                className={styles.demoPill}
                aria-pressed={email === acc.email}
                onClick={() => {
                  setEmail(acc.email);
                  setPassword(DEMO_PASSWORD);
                  setErrors({});
                  setFormError('');
                }}
              >
                {acc.label}
              </button>
            ))}
          </div>
        </div>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {formError && (
          <div id={`${id}-form-error`} ref={formErrorRef} className={styles.alert} role="alert" tabIndex={-1}>
            {formError}
            {badCredentials && (
              <>
                {' '}New here? <Link href="/auth/register">Create an account</Link>.
              </>
            )}
          </div>
        )}

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
              if (errors.email) setErrors((x) => ({ ...x, email: undefined }));
            }}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={errors.email ? `${id}-email-error` : undefined}
            required
          />
          {errors.email && <p id={`${id}-email-error`} className={styles.fieldError}>{errors.email}</p>}
        </div>

        <div className={styles.field}>
          <div className={styles.labelRow}>
            <label htmlFor={`${id}-password`} className={styles.label}>Password</label>
            <Link href="/auth/forgot" className={step.forgotLink}>Forgot password?</Link>
          </div>
          <PasswordInput
            id={`${id}-password`}
            value={password}
            onChange={(v) => {
              setPassword(v);
              if (errors.password) setErrors((x) => ({ ...x, password: undefined }));
            }}
            autoComplete="current-password"
            invalid={!!errors.password}
            describedBy={errors.password ? `${id}-password-error` : undefined}
          />
          {errors.password && <p id={`${id}-password-error`} className={styles.fieldError}>{errors.password}</p>}
        </div>

        <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Signing in…' : 'Sign in'}
        </button>
      </form>

      <p className={styles.switch}>
        New to AsteAI? <Link href="/auth/register">Create an account</Link>
      </p>
    </div>
  );
}
