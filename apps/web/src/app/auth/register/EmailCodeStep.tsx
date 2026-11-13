'use client';

/**
 * Sign-up steps 1–2: enter an email, receive a 6-digit code, enter it. On success the
 * parent gets the verified address and a short-lived ticket for POST /auth/register.
 */
import Link from 'next/link';
import { useEffect, useId, useRef, useState, type FormEvent } from 'react';
import { ApiError } from '@/lib/api';
import { LOGIN_PATH } from '@/lib/routes';
import { OtpInput } from '@/components/ui';
import { useHydrated } from '@/hooks/useHydrated';
import { Turnstile, turnstileRequired, type TurnstileHandle } from '@/components/forms/Turnstile';
import { publicFormsApi } from '@/features/public-forms/api';
import { EMAIL_RE, Spinner, authErrorMessage } from '../_components/shared';
import styles from '../auth.module.css';

export function EmailCodeStep({ initialEmail, onVerified }: {
  initialEmail: string;
  onVerified: (email: string, ticket: string, ticketExpiresIn: number) => void;
}) {
  const id = useId();
  const hydrated = useHydrated();
  const [stage, setStage] = useState<'email' | 'code'>('email');
  const [email, setEmail] = useState(initialEmail);
  const [code, setCode] = useState('');
  const [token, setToken] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const [resendIn, setResendIn] = useState(0);
  const turnstile = useRef<TurnstileHandle>(null);
  const alertRef = useRef<HTMLDivElement>(null);
  const codeHeading = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (resendIn <= 0) return;
    const t = window.setTimeout(() => setResendIn((n) => n - 1), 1000);
    return () => window.clearTimeout(t);
  }, [resendIn]);

  const fail = (msg: string) => {
    setError(msg);
    requestAnimationFrame(() => alertRef.current?.focus());
  };

  async function send() {
    setError('');
    const addr = email.trim();
    if (!EMAIL_RE.test(addr)) return fail('Enter a valid email address, like name@company.com.');
    if (turnstileRequired() && !token) return fail('Please complete the security check.');
    setPending(true);
    try {
      const res = await publicFormsApi.sendOtp(addr, token);
      setStage('code');
      setCode('');
      setResendIn(res.resendAfter);
      requestAnimationFrame(() => codeHeading.current?.focus());
    } catch (err) {
      if (err instanceof ApiError && err.status === 429 && stage === 'code') {
        fail('A code was sent moments ago. Check your inbox (and spam), or wait a minute to resend.');
      } else {
        fail(authErrorMessage(err, 'We couldn’t send a code. Please try again.'));
      }
      turnstile.current?.reset();
    } finally {
      setPending(false);
    }
  }

  async function verify(value = code) {
    if (pending) return;
    setError('');
    if (!/^\d{6}$/.test(value)) return fail('Enter the 6-digit code from the email.');
    setPending(true);
    try {
      const res = await publicFormsApi.verifyOtp(email.trim(), value);
      onVerified(email.trim().toLowerCase(), res.otpTicket, res.expiresIn);
    } catch (err) {
      setCode('');
      fail(err instanceof ApiError && err.status === 400
        ? 'That code is incorrect or has expired. Check the latest email, or send a new code.'
        : authErrorMessage(err, 'We couldn’t check the code. Please try again.'));
    } finally {
      setPending(false);
    }
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (pending) return;
    if (stage === 'email') void send();
    else void verify();
  };

  return (
    <form method="post" className={styles.form} onSubmit={onSubmit} noValidate>
      {error && <div ref={alertRef} className={styles.alert} role="alert" tabIndex={-1}>{error}</div>}

      {stage === 'email' ? (
        <>
          <div className={styles.field}>
            <label htmlFor={`${id}-email`} className={styles.label}>Work or personal email</label>
            <input
              id={`${id}-email`}
              type="email"
              inputMode="email"
              autoComplete="email"
              autoCapitalize="none"
              spellCheck={false}
              className={styles.input}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <p className={styles.hint}>We’ll email you a 6-digit code to confirm it’s yours.</p>
          </div>
          <Turnstile ref={turnstile} onToken={setToken} action="signup" />
          <button type="submit" className={styles.submit} disabled={!hydrated || pending} aria-busy={pending}>
            {pending && <Spinner />}
            {pending ? 'Sending code…' : 'Email me a code'}
          </button>
        </>
      ) : (
        <>
          <p ref={codeHeading} tabIndex={-1} className={styles.notice} style={{ outline: 'none' }}>
            We sent a code to <strong>{email.trim()}</strong>. It expires in 10 minutes.
          </p>
          <OtpInput value={code} onChange={setCode} onComplete={(v) => void verify(v)} disabled={pending} label="6-digit verification code" />
          <button type="submit" className={styles.submit} disabled={pending || code.length !== 6} aria-busy={pending}>
            {pending && <Spinner />}
            {pending ? 'Checking…' : 'Verify email'}
          </button>
          <p className={styles.switch}>
            <button type="button" className={styles.reveal} style={{ position: 'static' }} onClick={() => void send()} disabled={resendIn > 0 || pending}>
              {resendIn > 0 ? `Resend code in ${resendIn}s` : 'Resend code'}
            </button>
            {' · '}
            <button type="button" className={styles.reveal} style={{ position: 'static' }} onClick={() => { setStage('email'); setError(''); }}>
              Use a different email
            </button>
          </p>
          <p className={styles.hint}>
            Already have an account with this address? We emailed a sign-in link instead. <Link href={LOGIN_PATH}>Sign in</Link>
          </p>
        </>
      )}
    </form>
  );
}
