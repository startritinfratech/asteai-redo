import { randomBytes } from 'crypto';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32: no I, L, O, U

/**
 * Short, human-readable record id such as `REQ-7K3M9Q2X`.
 *
 * Uses the CSPRNG (40 bits of entropy for the default length) instead of
 * `Math.random()`, whose 4–6 character ids collided after a few thousand rows.
 */
export function generateId(prefix: string, length = 8): string {
  const bytes = randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += ALPHABET[bytes[i] & 31];
  return `${prefix}-${out}`;
}
