/**
 * Single-use tokens sent by email (password reset, email verification). The raw token is
 * 32 random bytes (base64url) and appears only in the email; the database keeps its
 * SHA-256. Issuing a token retires the user's older unused tokens for the same purpose.
 */
import { randomBytes } from 'crypto';
import type { Pool, PoolClient } from 'pg';
import { sha256Hex } from './totp';

export type EmailTokenPurpose = 'verify_email' | 'reset_password';

export const RESET_TOKEN_TTL_MS = 30 * 60_000;
export const VERIFY_TOKEN_TTL_MS = 24 * 60 * 60_000;

type Queryable = Pool | PoolClient;

export async function issueEmailToken(
  db: Queryable, userId: string, purpose: EmailTokenPurpose, ttlMs: number,
): Promise<string> {
  const raw = randomBytes(32).toString('base64url');
  await db.query(
    `UPDATE auth_tokens SET used_at = NOW() WHERE user_id = $1 AND purpose = $2 AND used_at IS NULL`,
    [userId, purpose],
  );
  await db.query(
    `INSERT INTO auth_tokens (user_id, purpose, token_hash, expires_at) VALUES ($1, $2, $3, $4)`,
    [userId, purpose, sha256Hex(raw), new Date(Date.now() + ttlMs)],
  );
  return raw;
}

/**
 * Marks the token used and returns its user id, or null when it is unknown, used,
 * expired or for another purpose. The conditional UPDATE makes it single-use even
 * under concurrent requests.
 */
export async function consumeEmailToken(
  db: Queryable, raw: string, purpose: EmailTokenPurpose,
): Promise<string | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(raw)) return null;
  const { rows } = await db.query<{ user_id: string }>(
    `UPDATE auth_tokens SET used_at = NOW()
      WHERE token_hash = $1 AND purpose = $2 AND used_at IS NULL AND expires_at > NOW()
      RETURNING user_id`,
    [sha256Hex(raw), purpose],
  );
  return rows[0]?.user_id ?? null;
}
