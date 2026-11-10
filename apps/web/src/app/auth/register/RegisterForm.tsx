'use client';

import Link from 'next/link';
import { useId, useRef, useState, type FormEvent } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { clsx } from 'clsx';
import type { UserRole } from '@asteai/types';
import { ApiError } from '@/lib/api';
import { LOGIN_PATH, ROLE_HOME } from '@/lib/routes';
import { useAuthHydrated, useAuthStore } from '@/store/auth';
import { EMAIL_RE, PasswordInput, Spinner, authErrorMessage } from '../_components/shared';
import styles from '../auth.module.css';

/** The roles the API lets people self-register as (RegisterDto). Admin is never offered. */
const ROLES = [
  { value: 'Employer', name: 'Employer / HR', desc: 'Hire with assessments, interviews and a pipeline' },
  { value: 'Candidate', name: 'Candidate', desc: 'Get assessed once and earn a Talent Passport' },
  { value: 'Freelancer', name: 'Expert / freelancer', desc: 'Win projects and get paid from escrow' },
  { value: 'Buyer', name: 'Buyer', desc: 'Hire experts for projects under escrow' },
] as const satisfies readonly { value: UserRole; name: string; desc: string }[];

type SelfRole = (typeof ROLES)[number]['value'];
const isSelfRole = (v: string | null): v is SelfRole => ROLES.some((r) => r.value === v);

/** Server rule (RegisterDto): at least 8 characters. */
const MIN_PASSWORD = 8;

type Field = 'firstName' | 'lastName' | 'email' | 'password' | 'role' | 'terms';
type Errors = Partial<Record<Field, string>>;
const ORDER: Field[] = ['firstName', 'lastName', 'email', 'password', 'role', 'terms'];

export function RegisterForm() {
  const router = useRouter();
  const roleParam = useSearchParams().get('role');
  const register = useAuthStore((s) => s.register);
  const user = useAuthStore((s) => s.user);
  const hydrated = useAuthHydrated();
  const id = useId();
  const fid = (f: Field) => `${id}-${f}`;

  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<SelfRole | ''>(isSelfRole(roleParam) ? roleParam : '');
  const [terms, setTerms] = useState(false);
  const [errors, setErrors] = useState<Errors>({});
  const [formError, setFormError] = useState('');
  const [emailTaken, setEmailTaken] = useState(false);
  const [pending, setPending] = useState(false);
  const formErrorRef = useRef<HTMLDivElement>(null);

  const longEnough = password.length >= MIN_PASSWORD;

  function clear(field: Field) {
    if (errors[field]) setErrors((x) => ({ ...x, [field]: undefined }));
  }

  function validate(): Errors {
    const e: Errors = {};
    if (!firstName.trim()) e.firstName = 'Enter your first name.';
    if (!lastName.trim()) e.lastName = 'Enter your last name.';
    if (!email.trim()) e.email = 'Enter your email address.';
    else if (!EMAIL_RE.test(email.trim())) e.email = 'Enter a valid email address, like name@company.com.';
    if (!password) e.password = 'Choose a password.';
    else if (!longEnough) e.password = `Use at least ${MIN_PASSWORD} characters.`;
    if (!role) e.role = 'Choose how you’ll use AsteAI.';
    if (!terms) e.terms = 'You need to accept the terms to create an account.';
    return e;
  }

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setFormError('');
    setEmailTaken(false);
    const found = validate();
    setErrors(found);
    const first = ORDER.find((f) => found[f]);
    if (first) {
      const target = first === 'role' ? document.querySelector<HTMLInputElement>(`input[name="${id}-role"]`) : document.getElementById(fid(first));
      target?.focus();
      return;
    }
    if (!role) return;

    setPending(true);
    try {
      const created = await register({
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        email: email.trim(),
        password,
        role,
      });
      router.replace(ROLE_HOME[created.role]);
    } catch (err) {
      setPending(false);
      setEmailTaken(err instanceof ApiError && err.status === 409);
      setFormError(authErrorMessage(err, 'We couldn’t create your account. Please try again.'));
      requestAnimationFrame(() => formErrorRef.current?.focus());
    }
  }

  const describe = (f: Field, extra?: string) =>
    [extra, errors[f] ? `${fid(f)}-error` : undefined].filter(Boolean).join(' ') || undefined;

  const fieldError = (f: Field) =>
    errors[f] ? <p id={`${fid(f)}-error`} className={styles.fieldError}>{errors[f]}</p> : null;

  return (
    <div className={clsx(styles.card, styles.cardWide)}>
      <div>
        <h1 className={styles.title}>Create your account</h1>
        <p className={styles.subtitle}>Hire, get certified, or deliver expert work — all in one place.</p>
      </div>

      {hydrated && user && (
        <p className={styles.notice}>
          You&apos;re already signed in as {user.email}. <Link href={ROLE_HOME[user.role]}>Go to dashboard</Link>
        </p>
      )}

      <form className={styles.form} onSubmit={onSubmit} noValidate>
        {formError && (
          <div ref={formErrorRef} className={styles.alert} role="alert" tabIndex={-1}>
            {formError}
            {emailTaken && (
              <>
                {' '}<Link href={LOGIN_PATH}>Sign in instead</Link>.
              </>
            )}
          </div>
        )}

        <div className={styles.row}>
          <div className={styles.field}>
            <label htmlFor={fid('firstName')} className={styles.label}>First name</label>
            <input
              id={fid('firstName')}
              name="given-name"
              className={styles.input}
              value={firstName}
              onChange={(e) => { setFirstName(e.target.value); clear('firstName'); }}
              autoComplete="given-name"
              aria-invalid={errors.firstName ? true : undefined}
              aria-describedby={describe('firstName')}
              required
            />
            {fieldError('firstName')}
          </div>
          <div className={styles.field}>
            <label htmlFor={fid('lastName')} className={styles.label}>Last name</label>
            <input
              id={fid('lastName')}
              name="family-name"
              className={styles.input}
              value={lastName}
              onChange={(e) => { setLastName(e.target.value); clear('lastName'); }}
              autoComplete="family-name"
              aria-invalid={errors.lastName ? true : undefined}
              aria-describedby={describe('lastName')}
              required
            />
            {fieldError('lastName')}
          </div>
        </div>

        <div className={styles.field}>
          <label htmlFor={fid('email')} className={styles.label}>Email</label>
          <input
            id={fid('email')}
            name="email"
            type="email"
            inputMode="email"
            className={styles.input}
            value={email}
            onChange={(e) => { setEmail(e.target.value); clear('email'); }}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={errors.email ? true : undefined}
            aria-describedby={describe('email')}
            required
          />
          {fieldError('email')}
        </div>

        <div className={styles.field}>
          <label htmlFor={fid('password')} className={styles.label}>Password</label>
          <PasswordInput
            id={fid('password')}
            value={password}
            onChange={(v) => { setPassword(v); clear('password'); }}
            autoComplete="new-password"
            invalid={!!errors.password}
            describedBy={describe('password', `${fid('password')}-reqs`)}
          />
          <ul id={`${fid('password')}-reqs`} className={styles.reqs} aria-label="Password requirements">
            <li className={clsx(styles.req, longEnough && styles.reqMet)}>
              <span className={styles.reqDot} aria-hidden="true">{longEnough ? '✓' : ''}</span>
              At least {MIN_PASSWORD} characters{longEnough && <span className={styles.srOnly}> (met)</span>}
            </li>
            <li className={styles.req}>
              <span className={styles.reqDot} aria-hidden="true" />
              Tip: a longer passphrase is stronger than a short, complex one
            </li>
          </ul>
          {fieldError('password')}
        </div>

        <fieldset
          className={styles.fieldset}
          aria-describedby={errors.role ? `${fid('role')}-error` : undefined}
        >
          <legend className={styles.legend}>I want to join as</legend>
          <div className={styles.roles}>
            {ROLES.map((r) => (
              <label key={r.value} className={styles.role}>
                <input
                  type="radio"
                  name={`${id}-role`}
                  value={r.value}
                  checked={role === r.value}
                  onChange={() => { setRole(r.value); clear('role'); }}
                />
                <span>
                  <span className={styles.roleName}>{r.name}</span>
                  <span className={styles.roleDesc}>{r.desc}</span>
                </span>
              </label>
            ))}
          </div>
          {fieldError('role')}
        </fieldset>

        <div className={styles.field}>
          <label className={styles.consent}>
            <input
              id={fid('terms')}
              type="checkbox"
              checked={terms}
              onChange={(e) => { setTerms(e.target.checked); clear('terms'); }}
              aria-invalid={errors.terms ? true : undefined}
              aria-describedby={describe('terms')}
              required
            />
            <span>
              I agree to the AsteAI{' '}
              <Link href="/legal/terms" target="_blank" rel="noopener noreferrer">
                Terms of Service<span className={styles.srOnly}> (opens in a new tab)</span>
              </Link>{' '}
              and{' '}
              <Link href="/legal/privacy" target="_blank" rel="noopener noreferrer">
                Privacy Policy<span className={styles.srOnly}> (opens in a new tab)</span>
              </Link>
              .
            </span>
          </label>
          {fieldError('terms')}
        </div>

        <button type="submit" className={styles.submit} disabled={pending} aria-busy={pending}>
          {pending && <Spinner />}
          {pending ? 'Creating your account…' : 'Create account'}
        </button>
      </form>

      <p className={styles.switch}>
        Already have an account? <Link href={LOGIN_PATH}>Sign in</Link>
      </p>
    </div>
  );
}
