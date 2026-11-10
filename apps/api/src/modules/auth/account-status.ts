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
