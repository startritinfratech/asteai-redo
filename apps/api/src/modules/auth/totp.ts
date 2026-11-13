/**
 * TOTP (RFC 6238 over RFC 4226 HOTP) with node:crypto, plus the AES-256-GCM sealing used
 * to store TOTP secrets and the hashing used for one-time codes and email tokens.
 */
import { createCipheriv, createDecipheriv, createHash, createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'crypto';
import { TOTP_DIGITS } from '@asteai/types';

export const TOTP_PERIOD_SECONDS = 30;
export { TOTP_DIGITS };
/** Codes from one step before or after the current one are accepted (clock drift). */
export const TOTP_WINDOW = 1;

const BASE32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += BASE32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = BASE32.indexOf(ch);
    if (idx < 0) throw new Error('Invalid base32');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export type TotpAlgorithm = 'sha1' | 'sha256' | 'sha512';

/** RFC 4226 HOTP value for a counter. */
export function hotp(secret: Buffer, counter: number | bigint, digits = TOTP_DIGITS, algorithm: TotpAlgorithm = 'sha1'): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac(algorithm, secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary = ((mac[offset] & 0x7f) << 24) | (mac[offset + 1] << 16) | (mac[offset + 2] << 8) | mac[offset + 3];
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SECONDS);
}

/** The TOTP code for a moment (RFC 6238). */
export function totp(secret: Buffer, nowMs = Date.now(), digits = TOTP_DIGITS, algorithm: TotpAlgorithm = 'sha1'): string {
  return hotp(secret, timeStep(nowMs), digits, algorithm);
}

/**
 * Checks a 6-digit code against the current step ±TOTP_WINDOW. Returns the matched time
 * step (so the caller can refuse a step already used), or null.
 */
export function verifyTotp(secret: Buffer, code: string, nowMs = Date.now()): number | null {
  const clean = code.replace(/\s/g, '');
  if (!/^\d{6}$/.test(clean)) return null;
  const current = timeStep(nowMs);
  let matched: number | null = null;
  // Check every candidate step so the timing does not depend on which one matched.
  for (let delta = -TOTP_WINDOW; delta <= TOTP_WINDOW; delta += 1) {
    const step = current + delta;
    if (step < 0) continue;
    if (safeEqual(hotp(secret, step), clean) && matched === null) matched = step;
  }
  return matched;
}

export function generateTotpSecret(): Buffer {
  return randomBytes(20); // 160 bits, the RFC 4226 recommended length for SHA-1
}

export function otpauthUri(secret: Buffer, accountName: string, issuer = 'AsteAI'): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(accountName)}`;
  const params = new URLSearchParams({
    secret: base32Encode(secret),
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

export function sha256Hex(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** A 32-byte key derived from a configured secret for one purpose (HKDF-SHA256). */
export function deriveKey(secret: string, info: string): Buffer {
  return Buffer.from(hkdfSync('sha256', Buffer.from(secret), Buffer.from('asteai-account-security'), Buffer.from(info), 32));
}

/** AES-256-GCM: `v1.<iv>.<tag>.<ciphertext>`, base64url parts. */
export function seal(plaintext: Buffer, key: Buffer): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function unseal(sealed: string, key: Buffer): Buffer {
  const [version, iv, tag, ct] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || ct === undefined) throw new Error('Unrecognised sealed value');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]);
}

const BACKUP_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789'; // no 0/o, 1/l/i

/** A one-time backup code such as `k7tq-3mzp-x9ad` (about 59 bits; one-time, and every guess counts towards the lockout). */
export function generateBackupCode(): string {
  const bytes = randomBytes(12);
  let out = '';
  for (let i = 0; i < 12; i += 1) {
    out += BACKUP_ALPHABET[bytes[i] % BACKUP_ALPHABET.length];
    if (i === 3 || i === 7) out += '-';
  }
  return out;
}

/** Case, spaces and dashes don't matter when a backup code is typed back. */
export function normalizeBackupCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9]/g, '');
}
