/**
 * SQL condition (on `user_accounts`, unaliased) that is true for an account that is neither
 * banned nor currently suspended. A suspension with a `suspended_until` in the past has lapsed;
 * one without an end date lasts until it is lifted.
 */
export const NOT_BLOCKED_SQL =
  `is_banned = FALSE AND (is_suspended = FALSE OR (suspended_until IS NOT NULL AND suspended_until <= NOW()))`;

export interface BlockColumns {
  is_banned: boolean;
  is_suspended: boolean;
  suspended_until: Date | string | null;
}

/** The same rule as NOT_BLOCKED_SQL, for a row already loaded. */
export function isBlocked(row: BlockColumns, now = Date.now()): boolean {
  if (row.is_banned) return true;
  if (!row.is_suspended) return false;
  return row.suspended_until === null || new Date(row.suspended_until).getTime() > now;
}

/**
 * SQL condition (on `user_accounts`, unaliased) for an account that still exists: not
 * deactivated and not (soft) deleted. Deleting an account sets both account_status
 * 'deleted' and deleted_at, and anonymises the email, so a deleted account can't sign in.
 */
export const ACCOUNT_ACTIVE_SQL = `account_status = 'active' AND deleted_at IS NULL`;

export interface ActiveColumns {
  account_status: string;
  deleted_at?: Date | string | null;
}

/** The same rule as ACCOUNT_ACTIVE_SQL, for a row already loaded. */
export function isActiveAccount(row: ActiveColumns): boolean {
  return row.account_status === 'active' && !row.deleted_at;
}

/** The issue-time claims of an access token. `iatMs` exists on tokens minted since it was added. */
export interface TokenIssueTimes {
  iat?: unknown;
  iatMs?: unknown;
}

/**
 * SQL condition (on `user_accounts`, unaliased) for an access token issued after the last
 * password change or reset, so a change signs out every older token.
 *
 * `$<msParam>` is the token's `iatMs` claim (milliseconds) or NULL and `$<secParam>` its JWT
 * `iat` (seconds); build both with tokenIssueParams(). With `iatMs` the comparison is exact
 * to the millisecond, so a token minted just before a change in the same second is refused.
 * Tokens minted before the claim existed keep the old second-granularity rule (the change,
 * truncated to the second, must not be after `iat`).
 */
export function tokenNotRevokedSql(msParam: number, secParam: number): string {
  return `(password_changed_at IS NULL OR CASE
            WHEN $${msParam}::double precision IS NULL
              THEN date_trunc('second', password_changed_at) <= to_timestamp($${secParam}::double precision)
            ELSE password_changed_at <= to_timestamp($${msParam}::double precision / 1000) END)`;
}

/** The [iatMs or null, iat or 0] parameters for tokenNotRevokedSql(). */
export function tokenIssueParams(token: TokenIssueTimes): [number | null, number] {
  const ms = typeof token.iatMs === 'number' && Number.isFinite(token.iatMs) ? token.iatMs : null;
  const sec = typeof token.iat === 'number' && Number.isFinite(token.iat) ? token.iat : 0;
  return [ms, sec];
}
