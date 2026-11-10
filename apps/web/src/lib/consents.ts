/**
 * Consents are an append-only log: every grant or revoke inserts a row. The current
 * state of a purpose is its newest row.
 */
export interface ConsentRecord {
  id: string;
  purpose: string;
  status: string;
  created_at: string;
  revoked_at?: string | null;
}

/** The newest row per purpose. Ties on created_at go to the row listed later. */
export function latestConsentByPurpose<T extends Pick<ConsentRecord, 'purpose' | 'created_at'>>(
  rows: readonly T[] | null | undefined,
): Map<string, T> {
  const latest = new Map<string, T>();
  for (const row of rows ?? []) {
    const prev = latest.get(row.purpose);
    const t = Date.parse(row.created_at);
    const prevT = prev ? Date.parse(prev.created_at) : -Infinity;
    if (!prev || !(t < prevT)) latest.set(row.purpose, row);
  }
  return latest;
}
