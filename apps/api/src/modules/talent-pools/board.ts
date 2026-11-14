/** Pure Kanban helpers for Talent CRM pools (talent-pools.spec.ts). */
import type { PoolColumn } from '@asteai/types';

export const DEFAULT_COLUMNS: PoolColumn[] = [
  { key: 'sourced', label: 'Sourced' },
  { key: 'contacted', label: 'Contacted' },
  { key: 'engaged', label: 'Engaged' },
  { key: 'nurture', label: 'Nurture' },
  { key: 'hired', label: 'Hired' },
];

const STEP = 1024;

/**
 * A position strictly between two neighbours (fractional indexing): a move rewrites one
 * row. `before` / `after` are the positions of the cards it lands between (null at an end).
 */
export function positionBetween(before: number | null, after: number | null): number {
  if (before === null && after === null) return STEP;
  if (before === null) return (after as number) - STEP;
  if (after === null) return before + STEP;
  if (after <= before) throw new RangeError('after must be greater than before');
  return before + (after - before) / 2;
}

/** True when neighbours are so close that doubles can't split them any more (time to renumber). */
export function needsRebalance(before: number | null, after: number | null): boolean {
  return before !== null && after !== null && after - before < 1e-9;
}

/** `Phone screen` → `phone_screen`. */
export function columnKey(label: string): string {
  return label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40);
}

/**
 * Validates a column list: 1–12 columns, labels 1–40 characters, unique keys. Keys are
 * derived from labels when missing, and kept when given, so renaming a column doesn't
 * orphan its cards.
 */
export function normalizeColumns(input: readonly { key?: string; label: string }[]): PoolColumn[] | { error: string } {
  if (!input.length || input.length > 12) return { error: 'A pool needs 1–12 columns' };
  const out: PoolColumn[] = [];
  for (const c of input) {
    const label = (c.label ?? '').trim().slice(0, 40);
    if (!label) return { error: 'Every column needs a name' };
    const key = (c.key && /^[a-z0-9_]{1,40}$/.test(c.key) ? c.key : columnKey(label)) || `col_${out.length + 1}`;
    if (out.some((o) => o.key === key)) return { error: `Two columns are both called "${label}"` };
    out.push({ key, label });
  }
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

/** Cleans a batch of prospects: valid, lowercase, de-duplicated emails; at most `max`. */
export function cleanProspects(
  input: readonly { email: string; fullName?: string; tags?: string[] }[], max = 500,
): { valid: { email: string; fullName: string; tags: string[] }[]; invalid: string[] } {
  const seen = new Set<string>();
  const valid: { email: string; fullName: string; tags: string[] }[] = [];
  const invalid: string[] = [];
  for (const p of input.slice(0, max)) {
    const email = (p.email ?? '').trim().toLowerCase();
    if (!EMAIL.test(email) || email.length > 255) {
      invalid.push(p.email);
      continue;
    }
    if (seen.has(email)) continue;
    seen.add(email);
    const tags = [...new Set((p.tags ?? []).map((t) => t.trim().toLowerCase().slice(0, 30)).filter(Boolean))].slice(0, 10);
    valid.push({ email, fullName: (p.fullName ?? '').trim().slice(0, 160), tags });
  }
  return { valid, invalid };
}
