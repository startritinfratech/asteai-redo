/**
 * UI primitives – small className-based components that map 1:1
 * to the design system CSS variables from the original index.html.
 */
import { clsx } from 'clsx';
import styles from './ui.module.css';

// ── Panel ────────────────────────────────────────────────────────────────────
export function Panel({
  children, className,
}: { children: React.ReactNode; className?: string }) {
  return <div className={clsx(styles.panel, className)}>{children}</div>;
}

// ── Button ───────────────────────────────────────────────────────────────────
type BtnVariant = 'default' | 'primary' | 'mint' | 'rose' | 'sm';

export function Button({
  children, variant = 'default', disabled, onClick, type = 'button', className,
}: {
  children: React.ReactNode;
  variant?: BtnVariant | BtnVariant[];
  disabled?: boolean;
  onClick?: () => void;
  type?: 'button' | 'submit' | 'reset';
  className?: string;
}) {
  const variants = Array.isArray(variant) ? variant : [variant];
  return (
    <button
      type={type}
      disabled={disabled}
      onClick={onClick}
      data-voice-ignore={type === 'button' && !onClick ? true : undefined}
      className={clsx(
        styles.btn,
        variants.includes('primary') && styles.pri,
        variants.includes('mint')    && styles.mint,
        variants.includes('rose')    && styles.rose,
        variants.includes('sm')      && styles.sm,
        className,
      )}
    >
      {children}
    </button>
  );
}

// ── Tag ──────────────────────────────────────────────────────────────────────
type TagColor = 'default' | 'gold' | 'mint' | 'rose' | 'amber' | 'grey';

export function Tag({
  children, color = 'default',
}: { children: React.ReactNode; color?: TagColor }) {
  return (
    <span className={clsx(styles.tag, color !== 'default' && styles[color])}>
      {children}
    </span>
  );
}

// ── KPI block ─────────────────────────────────────────────────────────────────
export function KPI({ value, label }: { value: React.ReactNode; label: string }) {
  return (
    <div className={styles.kpi}>
      <div className={styles.kpiV}>{value}</div>
      <div className={styles.kpiL}>{label}</div>
    </div>
  );
}

// ── Eyebrow ───────────────────────────────────────────────────────────────────
export function Eyebrow({ children }: { children: React.ReactNode }) {
  return <div className={styles.eyebrow}>{children}</div>;
}

// ── Empty state ───────────────────────────────────────────────────────────────
export function Empty({ message = 'Nothing here yet' }: { message?: string }) {
  return <div className={styles.empty}>{message}</div>;
}

// ── Progress bar ──────────────────────────────────────────────────────────────
export function Progress({ value }: { value: number }) {
  return (
    <div className={styles.progress}>
      <i style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

// ── Bar chart ─────────────────────────────────────────────────────────────────
export function Bar({ value, max = 10, variant }: { value: number; max?: number; variant?: 'g' | 'm' }) {
  return (
    <div className={clsx(styles.bar, variant && styles[variant])}>
      <i style={{ width: `${(value / max) * 100}%` }} />
    </div>
  );
}

// ── Field ─────────────────────────────────────────────────────────────────────
export function Field({
  label, children,
}: { label: string; children: React.ReactNode }) {
  return (
    <label className={styles.field}>
      <span>{label}</span>
      {children}
    </label>
  );
}

// ── Page header ───────────────────────────────────────────────────────────────
export function PageHeader({
  eyebrow, title, sub, actions,
}: { eyebrow: string; title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className={styles.ph}>
      <div>
        <div className={styles.eyebrow}>{eyebrow}</div>
        <h1>{title}</h1>
        {sub && <p className={styles.phSub}>{sub}</p>}
      </div>
      {actions && <div className={styles.phActions}>{actions}</div>}
    </div>
  );
}

// ── Scene (a spoken line) ─────────────────────────────────────────────────────
export function Scene({ who, children }: { who: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className={styles.scene}>
      <span className={styles.who}>{who}</span>
      <p className={styles.say}>{children}</p>
    </div>
  );
}

// ── Evidence line ─────────────────────────────────────────────────────────────
export function Evidence({ title, children }: { title?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className={styles.ev}>
      {title && <b>{title}</b>}
      {children && <p className={styles.evQ}>{children}</p>}
    </div>
  );
}

// ── Chips (single choice) ─────────────────────────────────────────────────────
export function Chips<T extends string>({
  options, value, onChange, label,
}: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void; label?: string }) {
  return (
    <div className={styles.chips} role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          className={clsx(styles.chip, value === o.id && styles.chipOn)}
          onClick={() => onChange(o.id)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

// ── Passport-style card ───────────────────────────────────────────────────────
export function CertCard({ children }: { children: React.ReactNode }) {
  return <div className={styles.pp}>{children}</div>;
}

export function Hash({ children }: { children: React.ReactNode }) {
  return <span className={styles.hash}>{children}</span>;
}
