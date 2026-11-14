/**
 * Independent, in-browser check of a credential's Ed25519 signature with WebCrypto, so
 * the "verified" badge doesn't rest only on our server saying so: the signed payload,
 * the signature and the published public key are checked on the visitor's device.
 */
import type { VerificationResult } from '@asteai/types';

type Proof = Extract<VerificationResult, { valid: true }>['proof'];

function base64UrlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=');
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** true / false, or null when this browser has no Ed25519 in WebCrypto (then trust the server's answer). */
export async function verifyProofLocally(proof: Proof, subtle: SubtleCrypto | null = globalThis.crypto?.subtle ?? null): Promise<boolean | null> {
  if (!subtle || !proof.publicKey || proof.alg !== 'EdDSA') return null;
  let key: CryptoKey;
  try {
    key = await subtle.importKey('jwk', { kty: 'OKP', crv: 'Ed25519', x: proof.publicKey.x }, { name: 'Ed25519' }, false, ['verify']);
  } catch {
    return null; // Ed25519 unsupported here
  }
  try {
    return await subtle.verify({ name: 'Ed25519' }, key, base64UrlToBytes(proof.signature), new TextEncoder().encode(proof.payload));
  } catch {
    return false;
  }
}
