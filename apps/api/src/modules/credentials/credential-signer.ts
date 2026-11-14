import {
  createHash, createPrivateKey, createPublicKey, randomBytes, sign as edSign, verify as edVerify,
  type KeyObject,
} from 'crypto';

/**
 * Ed25519 signing for verifiable credentials.
 *
 * What is signed is the canonical JSON of the claims (keys sorted at every depth, no
 * whitespace), stored verbatim next to the signature. Anyone can re-check a credential
 * offline: canonical payload + base64url signature + the published public key (JWK).
 */

/** Stable JSON: object keys sorted recursively, no whitespace, undefined dropped. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('non-finite number');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map((v) => (v === undefined ? 'null' : canonicalJson(v))).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
}

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ'; // no 0/O, 1/I/L

/** `AST-XXXX-XXXX-XXXX`: about 59 bits of randomness, easy to read out and type. */
export function newCredentialCode(): string {
  const bytes = randomBytes(12);
  let s = '';
  for (let i = 0; i < 12; i++) s += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  return `AST-${s.slice(0, 4)}-${s.slice(4, 8)}-${s.slice(8, 12)}`;
}

export const CREDENTIAL_CODE = /^AST-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}-[2-9A-HJKMNP-Z]{4}$/;

/** Accepts lowercase and missing dashes, as people type codes. */
export function normalizeCode(raw: string): string | null {
  const s = raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!s.startsWith('AST') || s.length !== 15) return null;
  const code = `AST-${s.slice(3, 7)}-${s.slice(7, 11)}-${s.slice(11, 15)}`;
  return CREDENTIAL_CODE.test(code) ? code : null;
}

// PKCS#8 wrapper for a raw 32-byte Ed25519 seed (RFC 8410).
const PKCS8_ED25519_PREFIX = Buffer.from('302e020100300506032b657004220420', 'hex');

export function privateKeyFromSeed(seed: Buffer): KeyObject {
  if (seed.length !== 32) throw new Error('Ed25519 seed must be 32 bytes');
  return createPrivateKey({ key: Buffer.concat([PKCS8_ED25519_PREFIX, seed]), format: 'der', type: 'pkcs8' });
}

export interface PublicJwk { kty: 'OKP'; crv: 'Ed25519'; x: string; kid: string; alg: 'EdDSA'; use: 'sig' }

export class CredentialSigner {
  readonly keyId: string;
  private readonly publicKeys = new Map<string, KeyObject>();

  /**
   * @param privateKey the active signing key
   * @param retired public keys of earlier signing keys, so old credentials still verify
   */
  constructor(private readonly privateKey: KeyObject, retired: KeyObject[] = []) {
    const pub = createPublicKey(privateKey);
    this.keyId = keyIdOf(pub);
    this.publicKeys.set(this.keyId, pub);
    for (const k of retired) this.publicKeys.set(keyIdOf(k), k);
  }

  sign(claims: Record<string, unknown>): { payload: string; signature: string; keyId: string } {
    const payload = canonicalJson({ ...claims, kid: this.keyId });
    const signature = edSign(null, Buffer.from(payload, 'utf8'), this.privateKey).toString('base64url');
    return { payload, signature, keyId: this.keyId };
  }

  /** True only for an untampered payload signed by one of our keys. */
  verify(payload: string, signature: string, keyId: string): boolean {
    const key = this.publicKeys.get(keyId);
    if (!key || typeof signature !== 'string') return false;
    try {
      return edVerify(null, Buffer.from(payload, 'utf8'), key, Buffer.from(signature, 'base64url'));
    } catch {
      return false;
    }
  }

  jwks(): { keys: PublicJwk[] } {
    return {
      keys: [...this.publicKeys.entries()].map(([kid, key]) => {
        const jwk = key.export({ format: 'jwk' }) as { x: string };
        return { kty: 'OKP', crv: 'Ed25519', x: jwk.x, kid, alg: 'EdDSA', use: 'sig' };
      }),
    };
  }

  publicJwk(keyId: string): PublicJwk | null {
    return this.jwks().keys.find((k) => k.kid === keyId) ?? null;
  }
}

/** First 16 hex chars of SHA-256 over the raw public key. */
export function keyIdOf(publicKey: KeyObject): string {
  const raw = publicKey.export({ format: 'der', type: 'spki' });
  return `ed25519-${createHash('sha256').update(raw).digest('hex').slice(0, 16)}`;
}

/**
 * The signer from config. CREDENTIAL_SIGNING_KEY is a base64 32-byte seed (generate with
 * `openssl rand -base64 32`); CREDENTIAL_RETIRED_PUBLIC_KEYS lists earlier keys' JWK `x`
 * values, comma-separated. Outside production a key is derived from JWT_SECRET so local
 * setups work; production without a key gets null (issuing is then 503).
 */
export function signerFromConfig(get: (k: string) => string | undefined): CredentialSigner | null {
  const seed = get('CREDENTIAL_SIGNING_KEY');
  let privateKey: KeyObject;
  if (seed) {
    privateKey = privateKeyFromSeed(Buffer.from(seed, 'base64'));
  } else if (get('NODE_ENV') !== 'production' && get('JWT_SECRET')) {
    privateKey = privateKeyFromSeed(createHash('sha256').update(`asteai-credentials-dev:${get('JWT_SECRET')}`).digest());
  } else {
    return null;
  }
  const retired = (get('CREDENTIAL_RETIRED_PUBLIC_KEYS') ?? '')
    .split(',').map((x) => x.trim()).filter(Boolean)
    .map((x) => createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x }, format: 'jwk' }));
  return new CredentialSigner(privateKey, retired);
}
