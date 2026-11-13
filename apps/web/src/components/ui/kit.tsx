'use client';

/**
 * Interactive primitives shared by public and platform pages. Each is built on native
 * elements (<dialog>, <details>, inputs) so focus handling and Esc come from the browser.
 */
import React, {
  createContext, useCallback, useContext, useEffect, useId, useMemo, useRef, useState,
} from 'react';
import { clsx } from 'clsx';
import { applyTheme, readTheme, type Theme } from '@/lib/theme';
import styles from './kit.module.css';

// ── Dialog / Sheet ───────────────────────────────────────────────────────────
export interface DialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: React.ReactNode;
  description?: React.ReactNode;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** `sheet` slides in from the side (mobile menus, filters). */
  variant?: 'modal' | 'sheet';
  className?: string;
}

/** Modal dialog on native <dialog>: focus is trapped, Esc closes, page scroll is locked. */
export function Dialog({
  open, onOpenChange, title, description, children, footer, size = 'md', variant = 'modal', className,
}: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) {
      el.showModal();
      document.documentElement.style.overflow = 'hidden';
    } else if (!open && el.open) {
      el.close();
    }
    return () => { document.documentElement.style.overflow = ''; };
  }, [open]);

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      className={clsx(styles.dialog, styles[size], variant === 'sheet' && styles.sheet, className)}
      onClose={() => { document.documentElement.style.overflow = ''; onOpenChange(false); }}
      onCancel={(e) => { e.preventDefault(); onOpenChange(false); }}
      // A click on the dialog element itself (not its content) is a click on the backdrop.
      onClick={(e) => { if (e.target === e.currentTarget) onOpenChange(false); }}
    >
      <div className={styles.dialogBody}>
        <div className={styles.dialogHead}>
          <h2 id={titleId} className={styles.dialogTitle}>{title}</h2>
          <button type="button" className={styles.iconBtn} aria-label="Close" onClick={() => onOpenChange(false)}>
            <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        </div>
        {description && <p id={descId} className={styles.dialogDesc}>{description}</p>}
        {open && children}
        {footer && <div className={styles.dialogFoot}>{footer}</div>}
      </div>
    </dialog>
  );
}

// ── Accordion (FAQ) ──────────────────────────────────────────────────────────
export interface AccordionItem { q: string; a: React.ReactNode }

/** <details>-based accordion. `single` keeps at most one item open. */
export function Accordion({ items, single = true }: { items: readonly AccordionItem[]; single?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const onToggle = (e: React.SyntheticEvent<HTMLDetailsElement>) => {
    if (!single || !e.currentTarget.open) return;
    ref.current?.querySelectorAll('details[open]').forEach((d) => {
      if (d !== e.currentTarget) (d as HTMLDetailsElement).open = false;
    });
  };
  return (
    <div ref={ref} className={styles.accordion}>
      {items.map((item) => (
        <details key={item.q} className={styles.accItem} onToggle={onToggle}>
          <summary className={styles.accQ}>
            <span>{item.q}</span>
            <svg className={styles.accIcon} width="16" height="16" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 9l6 6 6-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </summary>
          <div className={styles.accA}>{item.a}</div>
        </details>
      ))}
    </div>
  );
}

// ── Tabs ─────────────────────────────────────────────────────────────────────
export interface TabItem<T extends string> { id: T; label: string; panel: React.ReactNode }

/** WAI-ARIA tabs with arrow-key roving focus. */
export function Tabs<T extends string>({
  items, value, onChange, label,
}: { items: readonly TabItem<T>[]; value?: T; onChange?: (id: T) => void; label: string }) {
  const [inner, setInner] = useState<T>(items[0]?.id);
  const current = value ?? inner;
  const base = useId();
  const listRef = useRef<HTMLDivElement>(null);
  const select = (id: T) => { setInner(id); onChange?.(id); };

  const onKeyDown = (e: React.KeyboardEvent) => {
    const idx = items.findIndex((i) => i.id === current);
    let next = idx;
    if (e.key === 'ArrowRight') next = (idx + 1) % items.length;
    else if (e.key === 'ArrowLeft') next = (idx - 1 + items.length) % items.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = items.length - 1;
    else return;
    e.preventDefault();
    select(items[next].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[next]?.focus();
  };

  return (
    <div>
      <div ref={listRef} role="tablist" aria-label={label} className={styles.tablist} onKeyDown={onKeyDown}>
        {items.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            id={`${base}-t-${t.id}`}
            aria-controls={`${base}-p-${t.id}`}
            aria-selected={t.id === current}
            tabIndex={t.id === current ? 0 : -1}
            className={clsx(styles.tab, t.id === current && styles.tabOn)}
            onClick={() => select(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
      {items.map((t) => (
        <div
          key={t.id}
          role="tabpanel"
          id={`${base}-p-${t.id}`}
          aria-labelledby={`${base}-t-${t.id}`}
          hidden={t.id !== current}
          tabIndex={0}
          className={styles.tabpanel}
        >
          {t.panel}
        </div>
      ))}
    </div>
  );
}

// ── OTP input ────────────────────────────────────────────────────────────────
/** One box per digit; typing advances, Backspace goes back, pasting fills every box. */
export function OtpInput({
  length = 6, value, onChange, onComplete, label = 'Verification code', disabled, error,
}: {
  length?: number;
  value: string;
  onChange: (v: string) => void;
  onComplete?: (v: string) => void;
  label?: string;
  disabled?: boolean;
  error?: string;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  const errId = useId();
  const digits = Array.from({ length }, (_, i) => value[i] ?? '');

  const commit = (next: string) => {
    const clean = next.replace(/\D/g, '').slice(0, length);
    onChange(clean);
    if (clean.length === length) onComplete?.(clean);
    return clean;
  };

  return (
    <fieldset className={styles.otp} aria-describedby={error ? errId : undefined}>
      <legend className={styles.srOnly}>{label}</legend>
      {digits.map((d, i) => (
        <input
          key={i}
          ref={(el) => { refs.current[i] = el; }}
          className={clsx(styles.otpBox, error && styles.invalid)}
          inputMode="numeric"
          autoComplete={i === 0 ? 'one-time-code' : 'off'}
          maxLength={length}
          aria-label={`Digit ${i + 1} of ${length}`}
          aria-invalid={error ? true : undefined}
          disabled={disabled}
          value={d}
          onChange={(e) => {
            const typed = e.target.value.replace(/\D/g, '');
            if (!typed) return;
            // A paste or autofill into one box carries the whole code.
            const merged = typed.length > 1 ? typed : value.slice(0, i) + typed + value.slice(i + 1);
            const clean = commit(merged);
            refs.current[Math.min(clean.length, length - 1)]?.focus();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Backspace') {
              e.preventDefault();
              const pos = d ? i : i - 1;
              if (pos < 0) return;
              commit(value.slice(0, pos) + value.slice(pos + 1));
              refs.current[pos]?.focus();
            } else if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
            else if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
          }}
          onFocus={(e) => e.target.select()}
        />
      ))}
      {error && <p id={errId} className={styles.error} role="alert">{error}</p>}
    </fieldset>
  );
}

// ── Password field with live rules ───────────────────────────────────────────
export interface PasswordRule { id: string; label: string; test: (v: string) => boolean }

export const DEFAULT_PASSWORD_RULES: readonly PasswordRule[] = [
  { id: 'len', label: 'At least 10 characters', test: (v) => v.length >= 10 },
  { id: 'upper', label: 'An uppercase letter', test: (v) => /[A-Z]/.test(v) },
  { id: 'lower', label: 'A lowercase letter', test: (v) => /[a-z]/.test(v) },
  { id: 'digit', label: 'A number', test: (v) => /\d/.test(v) },
  { id: 'symbol', label: 'A symbol', test: (v) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordMeetsRules(v: string, rules: readonly PasswordRule[] = DEFAULT_PASSWORD_RULES): boolean {
  return rules.every((r) => r.test(v));
}

export function PasswordField({
  label = 'Password', value, onChange, name = 'password', autoComplete = 'new-password',
  rules = DEFAULT_PASSWORD_RULES, showChecklist = true, error,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
  name?: string;
  autoComplete?: 'new-password' | 'current-password';
  rules?: readonly PasswordRule[];
  showChecklist?: boolean;
  error?: string;
}) {
  const id = useId();
  const [visible, setVisible] = useState(false);
  const listId = `${id}-rules`;
  const errId = `${id}-err`;
  const describedBy = [showChecklist ? listId : null, error ? errId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={styles.field}>
      <label htmlFor={id}>{label}</label>
      <div className={styles.pwWrap}>
        <input
          id={id}
          name={name}
          type={visible ? 'text' : 'password'}
          autoComplete={autoComplete}
          value={value}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy}
          className={clsx(styles.input, error && styles.invalid)}
          onChange={(e) => onChange(e.target.value)}
        />
        <button type="button" className={styles.pwToggle} aria-pressed={visible} onClick={() => setVisible((v) => !v)}>
          {visible ? 'Hide' : 'Show'}
        </button>
      </div>
      {showChecklist && (
        <ul id={listId} className={styles.rules} aria-label="Password requirements">
          {rules.map((r) => {
            const ok = r.test(value);
            return (
              <li key={r.id} className={clsx(ok && styles.ruleOk)}>
                <span aria-hidden="true">{ok ? '✓' : '○'}</span> {r.label}
                <span className={styles.srOnly}>{ok ? ' (met)' : ' (not met)'}</span>
              </li>
            );
          })}
        </ul>
      )}
      {error && <p id={errId} className={styles.error} role="alert">{error}</p>}
    </div>
  );
}

// ── Honeypot ─────────────────────────────────────────────────────────────────
/** Hidden from people (and assistive tech), filled by bots; the API drops submissions that fill it. */
export function Honeypot({ value, onChange, name = 'website' }: { value: string; onChange: (v: string) => void; name?: string }) {
  return (
    <div className={styles.honeypot} aria-hidden="true">
      <label>
        Website
        <input name={name} tabIndex={-1} autoComplete="off" value={value} onChange={(e) => onChange(e.target.value)} />
      </label>
    </div>
  );
}

// ── Toasts ───────────────────────────────────────────────────────────────────
type ToastVariant = 'default' | 'success' | 'error';
interface ToastMsg { id: number; title: string; description?: string; variant: ToastVariant }
type ToastFn = (t: { title: string; description?: string; variant?: ToastVariant }) => void;

const ToastContext = createContext<ToastFn | null>(null);

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastMsg[]>([]);
  const seq = useRef(0);
  const toast = useCallback<ToastFn>(({ title, description, variant = 'default' }) => {
    const id = ++seq.current;
    setToasts((all) => [...all, { id, title, description, variant }]);
    window.setTimeout(() => setToasts((all) => all.filter((t) => t.id !== id)), 5000);
  }, []);
  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className={styles.toasts} role="status" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={clsx(styles.toast, styles[`toast_${t.variant}`])}>
            <b>{t.title}</b>
            {t.description && <p>{t.description}</p>}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/** `const toast = useToast(); toast({ title: 'Saved' })`. Outside a provider it is a no-op. */
export function useToast(): ToastFn {
  return useContext(ToastContext) ?? (() => {});
}

// ── Theme toggle ─────────────────────────────────────────────────────────────
export function ThemeToggle({ className }: { className?: string }) {
  // Rendered as "dark" on the server; the real value is read after mount.
  const [theme, setTheme] = useState<Theme>('dark');
  useEffect(() => setTheme(readTheme()), []);
  const next: Theme = theme === 'dark' ? 'light' : 'dark';
  const label = useMemo(() => `Switch to ${next} theme`, [next]);
  return (
    <button
      type="button"
      className={clsx(styles.iconBtn, className)}
      aria-label={label}
      title={label}
      onClick={() => { applyTheme(next); setTheme(next); }}
    >
      {theme === 'dark' ? (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4.5" fill="none" stroke="currentColor" strokeWidth="2" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
      ) : (
        <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z" fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round" /></svg>
      )}
    </button>
  );
}
