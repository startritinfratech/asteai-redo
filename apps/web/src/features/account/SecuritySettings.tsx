'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import useSWR from 'swr';
import { ApiError, errorMessage } from '@/lib/api';
import { LOGIN_PATH } from '@/lib/routes';
import { useAuthStore } from '@/store/auth';
import { Button, Empty, PageHeader, Panel, Tag } from '@/components/ui';
import {
  SESSIONS_KEY, TWO_FACTOR_KEY, changePassword, currentSessionId, deleteAccount, disableTwoFactor, enableTwoFactor,
  listSessions, revokeSession, sendVerificationEmail, startTwoFactorSetup, twoFactorStatus,
} from './api';
import { QrCode } from './QrCode';
import { PASSWORD_MIN_LENGTH, type SessionInfo, type TwoFactorSetupResponse } from './types';
import styles from './Security.module.css';

/** A 403 from these endpoints means a wrong password or code; show the server's sentence. */
const message = (err: unknown, fallback: string) =>
  err instanceof ApiError && err.status >= 400 && err.status < 500 && err.message ? err.message : errorMessage(err, fallback);

const formatDate = (iso: string) =>
  new Date(iso).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// ── Small pieces ──────────────────────────────────────────────────────────────

function CopyButton({ text, label = 'Copy' }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="sm"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
          },
          () => setCopied(false),
        );
      }}
    >
      <span aria-live="polite">{copied ? 'Copied' : label}</span>
    </Button>
  );
}

function TextInput({
  label, value, onChange, type = 'password', autoComplete, className, inputMode, invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  type?: 'password' | 'text';
  autoComplete?: string;
  className?: string;
  inputMode?: 'numeric' | 'text';
  invalid?: boolean;
}) {
  const id = useId();
  return (
    <div className={styles.form} style={{ gap: 4 }}>
      <label htmlFor={id} className={styles.muted} style={{ fontWeight: 700, color: 'var(--fg-2)' }}>{label}</label>
      <input
        id={id}
        type={type}
        className={`${styles.input} ${className ?? ''}`}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        autoComplete={autoComplete}
        inputMode={inputMode}
        spellCheck={false}
        autoCapitalize="none"
        aria-invalid={invalid || undefined}
      />
    </div>
  );
}

function Section({ title, sub, aside, children, className }: {
  title: string; sub?: React.ReactNode; aside?: React.ReactNode; children?: React.ReactNode; className?: string;
}) {
  return (
    <Panel className={className}>
      <section className={styles.section} aria-label={title}>
        <div className={styles.sectionHead}>
          <div>
            <h2 className={styles.sectionTitle}>{title}</h2>
            {sub && <p className={styles.sectionSub}>{sub}</p>}
          </div>
          {aside}
        </div>
        {children}
      </section>
    </Panel>
  );
}

// ── Email ─────────────────────────────────────────────────────────────────────

function EmailSection() {
  const user = useAuthStore((s) => s.user);
  const [state, setState] = useState<'idle' | 'sending' | 'sent'>('idle');
  const [error, setError] = useState('');
  if (!user) return null;

  return (
    <Section
      title="Email address"
      sub={user.email}
      aside={user.emailVerified ? <Tag color="mint">Verified</Tag> : <Tag color="amber">Not verified</Tag>}
    >
      {!user.emailVerified && (
        <div className={styles.actions}>
          <Button
            disabled={state !== 'idle'}
            onClick={async () => {
              setState('sending');
              setError('');
              try {
                await sendVerificationEmail();
                setState('sent');
              } catch (err) {
                setState('idle');
                setError(message(err, 'Could not send the email'));
              }
            }}
          >
            {state === 'sending' ? 'Sending…' : 'Send verification email'}
          </Button>
          {state === 'sent' && <span className={styles.success} role="status">Sent. Check your inbox for the link.</span>}
          {error && <span className={styles.error} role="alert">{error}</span>}
        </div>
      )}
    </Section>
  );
}

// ── Password ──────────────────────────────────────────────────────────────────

function PasswordSection({ onChanged }: { onChanged: () => void }) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setDone(false);
    if (!current) return setError('Enter your current password.');
    if (next.length < PASSWORD_MIN_LENGTH) return setError(`Use at least ${PASSWORD_MIN_LENGTH} characters for the new password.`);
    if (next !== confirm) return setError('The new passwords don’t match.');
    setError('');
    setPending(true);
    try {
      await changePassword(current, next);
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
      onChanged();
    } catch (err) {
      setError(message(err, 'Could not change the password'));
    } finally {
      setPending(false);
    }
  }

  return (
    <Section title="Password" sub="Changing your password signs out every other device.">
      <form className={styles.form} onSubmit={onSubmit} noValidate>
        <TextInput label="Current password" value={current} onChange={setCurrent} autoComplete="current-password" />
        <TextInput label="New password" value={next} onChange={setNext} autoComplete="new-password" />
        <TextInput label="Confirm new password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        {error && <p className={styles.error} role="alert">{error}</p>}
        {done && <p className={styles.success} role="status">Password changed. Other devices were signed out.</p>}
        <div className={styles.actions}>
          <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Saving…' : 'Change password'}</Button>
        </div>
      </form>
    </Section>
  );
}

// ── Two-factor ────────────────────────────────────────────────────────────────

function BackupCodes({ codes, onDone }: { codes: string[]; onDone: () => void }) {
  return (
    <div className={styles.section}>
      <p className={styles.notice} role="status">
        Two-factor authentication is on. Save these backup codes somewhere safe, such as a password manager. Each
        works once if you lose your phone. <b>They won’t be shown again.</b>
      </p>
      <ul className={styles.codes} aria-label="Backup codes">
        {codes.map((c) => <li key={c}>{c}</li>)}
      </ul>
      <div className={styles.actions}>
        <CopyButton text={codes.join('\n')} label="Copy all codes" />
        <Button variant="primary" onClick={onDone}>I’ve saved my codes</Button>
      </div>
    </div>
  );
}

function Enrolment({ setup, onEnabled, onCancel }: {
  setup: TwoFactorSetupResponse; onEnabled: (codes: string[]) => void; onCancel: () => void;
}) {
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);
  const grouped = setup.secret.replace(/(.{4})/g, '$1 ').trim();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    const clean = code.replace(/\s/g, '');
    if (!/^\d{6}$/.test(clean)) return setError('Enter the 6-digit code from the app.');
    setError('');
    setPending(true);
    try {
      onEnabled((await enableTwoFactor(clean)).backupCodes);
    } catch (err) {
      setError(message(err, 'Could not turn on two-factor authentication'));
      setPending(false);
    }
  }

  return (
    <div className={styles.enrol}>
      <div className={styles.qr}>
        <QrCode value={setup.otpauthUri} size={184} label="QR code for your authenticator app" />
      </div>
      <div className={styles.section}>
        <ol className={styles.sectionSub} style={{ paddingLeft: 18, margin: 0 }}>
          <li>Scan the QR code with an authenticator app (Google Authenticator, Microsoft Authenticator, 1Password…).</li>
          <li>Or enter this key by hand (time-based, 6 digits):</li>
        </ol>
        <div className={styles.secretRow}>
          <code className={styles.mono}>{grouped}</code>
          <CopyButton text={setup.secret} label="Copy key" />
        </div>
        <details>
          <summary className={styles.muted}>Show the setup link</summary>
          <div className={styles.secretRow} style={{ marginTop: 8 }}>
            <code className={styles.mono}>{setup.otpauthUri}</code>
            <CopyButton text={setup.otpauthUri} label="Copy link" />
          </div>
        </details>
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <TextInput
            label="Code from the app"
            value={code}
            onChange={setCode}
            type="text"
            inputMode="numeric"
            autoComplete="one-time-code"
            className={styles.code}
            invalid={!!error}
          />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button type="submit" variant="primary" disabled={pending}>{pending ? 'Checking…' : 'Turn on'}</Button>
            <Button onClick={onCancel} disabled={pending}>Cancel</Button>
          </div>
        </form>
      </div>
    </div>
  );
}

function DisableTwoFactor({ onDisabled }: { onDisabled: () => void }) {
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [code, setCode] = useState('');
  const [useBackup, setUseBackup] = useState(false);
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  if (!open) return <div className={styles.actions}><Button variant="rose" onClick={() => setOpen(true)}>Turn off</Button></div>;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!password) return setError('Enter your password.');
    if (!code.trim()) return setError(useBackup ? 'Enter a backup code.' : 'Enter the 6-digit code from the app.');
    setError('');
    setPending(true);
    try {
      await disableTwoFactor(password, useBackup ? { backupCode: code.trim() } : { code: code.replace(/\s/g, '') });
      onDisabled();
    } catch (err) {
      setError(message(err, 'Could not turn off two-factor authentication'));
      setPending(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={onSubmit} noValidate>
      <TextInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
      <TextInput
        label={useBackup ? 'Backup code' : 'Code from the app'}
        value={code}
        onChange={setCode}
        type="text"
        inputMode={useBackup ? 'text' : 'numeric'}
        autoComplete="one-time-code"
        className={useBackup ? undefined : styles.code}
      />
      <div>
        <Button variant="sm" onClick={() => { setUseBackup((b) => !b); setCode(''); }}>
          {useBackup ? 'Use the app code instead' : 'Use a backup code'}
        </Button>
      </div>
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.actions}>
        <Button type="submit" variant="rose" disabled={pending}>{pending ? 'Turning off…' : 'Turn off two-factor'}</Button>
        <Button onClick={() => setOpen(false)} disabled={pending}>Cancel</Button>
      </div>
    </form>
  );
}

function TwoFactorSection() {
  const { data: status, error: loadError, isLoading, mutate } = useSWR(TWO_FACTOR_KEY, twoFactorStatus);
  const [setup, setSetup] = useState<TwoFactorSetupResponse | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const aside = status?.enabled ? <Tag color="mint">On</Tag> : status ? <Tag color="grey">Off</Tag> : null;

  let body: React.ReactNode;
  if (codes) {
    body = <BackupCodes codes={codes} onDone={() => { setCodes(null); void mutate(); }} />;
  } else if (setup) {
    body = (
      <Enrolment
        setup={setup}
        onEnabled={(c) => { setSetup(null); setCodes(c); void mutate(); }}
        onCancel={() => setSetup(null)}
      />
    );
  } else if (isLoading) {
    body = <p className={styles.muted}>Loading…</p>;
  } else if (loadError) {
    body = <p className={styles.error} role="alert">{message(loadError, 'Could not load two-factor status')}</p>;
  } else if (status?.enabled) {
    body = (
      <>
        <p className={styles.muted}>
          {status.enrolledAt ? `Turned on ${formatDate(status.enrolledAt)}. ` : ''}
          {status.backupCodesRemaining} of 10 backup codes left.
          {status.backupCodesRemaining <= 3 && ' Turn two-factor off and on again to get a new set.'}
        </p>
        <DisableTwoFactor onDisabled={() => void mutate()} />
      </>
    );
  } else {
    body = (
      <div className={styles.actions}>
        <Button
          variant="primary"
          disabled={starting}
          onClick={async () => {
            setStarting(true);
            setError('');
            try {
              setSetup(await startTwoFactorSetup());
            } catch (err) {
              setError(message(err, 'Could not start setup'));
            } finally {
              setStarting(false);
            }
          }}
        >
          {starting ? 'Starting…' : 'Set up two-factor authentication'}
        </Button>
        {error && <span className={styles.error} role="alert">{error}</span>}
      </div>
    );
  }

  return (
    <Section
      title="Two-factor authentication"
      sub="Ask for a code from an authenticator app when you sign in, as well as your password."
      aside={aside}
    >
      {body}
    </Section>
  );
}

// ── Sessions ──────────────────────────────────────────────────────────────────

/** "Chrome on Windows" from a user-agent string; good enough to tell devices apart. */
function describeAgent(ua: string | null): string {
  if (!ua) return 'Unknown device';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\//.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox'
    : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os = /Windows/.test(ua) ? 'Windows' : /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iOS'
    : /Mac OS X/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : null;
  return os ? `${browser} on ${os}` : browser;
}

function SessionsSection() {
  const router = useRouter();
  const logout = useAuthStore((s) => s.logout);
  const { data, error, isLoading, mutate } = useSWR<SessionInfo[]>(SESSIONS_KEY, listSessions);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState('');
  const current = currentSessionId();

  return (
    <Section title="Signed-in devices" sub="Sign out any device you don’t recognise, then change your password.">
      {isLoading && <p className={styles.muted}>Loading…</p>}
      {error && <p className={styles.error} role="alert">{message(error, 'Could not load your sessions')}</p>}
      {data && data.length === 0 && <Empty message="No active sessions" />}
      {data && data.length > 0 && (
        <ul className={styles.sessions}>
          {data.map((s) => {
            const isCurrent = s.id === current;
            return (
              <li key={s.id} className={styles.session}>
                <div>
                  <div className={styles.sessionName}>
                    {describeAgent(s.userAgent)}
                    {isCurrent && <Tag color="mint">This device</Tag>}
                  </div>
                  <div className={styles.sessionMeta}>
                    Signed in {formatDate(s.createdAt)} · last active {formatDate(s.lastUsedAt)}
                    {s.ipAddress ? ` · ${s.ipAddress}` : ''}
                  </div>
                </div>
                <Button
                  variant={isCurrent ? 'sm' : ['sm', 'rose']}
                  disabled={busy === s.id}
                  onClick={async () => {
                    setActionError('');
                    if (isCurrent) {
                      await logout();
                      router.replace(LOGIN_PATH);
                      return;
                    }
                    setBusy(s.id);
                    try {
                      await revokeSession(s.id);
                      await mutate();
                    } catch (err) {
                      setActionError(message(err, 'Could not sign that device out'));
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {isCurrent ? 'Sign out' : busy === s.id ? 'Signing out…' : 'Sign out device'}
                </Button>
              </li>
            );
          })}
        </ul>
      )}
      {actionError && <p className={styles.error} role="alert">{actionError}</p>}
    </Section>
  );
}

// ── Delete account ────────────────────────────────────────────────────────────

const CONFIRM_WORD = 'DELETE';

function DeleteAccountSection() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [pending, setPending] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (confirm !== CONFIRM_WORD) return setError(`Type ${CONFIRM_WORD} to confirm.`);
    if (!password) return setError('Enter your password.');
    setError('');
    setPending(true);
    try {
      await deleteAccount(password);
      router.replace('/');
    } catch (err) {
      setError(message(err, 'Could not delete the account'));
      setPending(false);
    }
  }

  return (
    <Section
      title="Delete account"
      sub="Closes your account and signs you out everywhere. Your email address is removed from the account, so you can’t sign in again. This can’t be undone."
      className={styles.danger}
    >
      {!open ? (
        <div className={styles.actions}><Button variant="rose" onClick={() => setOpen(true)}>Delete my account…</Button></div>
      ) : (
        <form className={styles.form} onSubmit={onSubmit} noValidate>
          <TextInput label={`Type ${CONFIRM_WORD} to confirm`} value={confirm} onChange={setConfirm} type="text" autoComplete="off" />
          <TextInput label="Password" value={password} onChange={setPassword} autoComplete="current-password" />
          {error && <p className={styles.error} role="alert">{error}</p>}
          <div className={styles.actions}>
            <Button type="submit" variant="rose" disabled={pending || confirm !== CONFIRM_WORD}>
              {pending ? 'Deleting…' : 'Permanently delete account'}
            </Button>
            <Button onClick={() => { setOpen(false); setPassword(''); setConfirm(''); setError(''); }} disabled={pending}>
              Cancel
            </Button>
          </div>
        </form>
      )}
    </Section>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function SecuritySettings() {
  const refreshUser = useAuthStore((s) => s.refreshUser);
  const { mutate: mutateSessions } = useSWR<SessionInfo[]>(SESSIONS_KEY, listSessions);

  // Pick up a verification done in another tab.
  useEffect(() => {
    void refreshUser();
  }, [refreshUser]);

  return (
    <div className={styles.page}>
      <PageHeader eyebrow="Account" title="Security" sub="Your password, two-factor authentication and signed-in devices." />
      <EmailSection />
      <PasswordSection onChanged={() => void mutateSessions()} />
      <TwoFactorSection />
      <SessionsSection />
      <DeleteAccountSection />
    </div>
  );
}
