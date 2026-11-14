import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createPublicKey, verify as edVerify } from 'crypto';
import { ServiceUnavailableException } from '@nestjs/common';
import { fakeDb } from '../../test-support/fakes';
import {
  canonicalJson, CREDENTIAL_CODE, CredentialSigner, newCredentialCode, normalizeCode, privateKeyFromSeed, signerFromConfig,
} from './credential-signer';
import { CredentialsService } from './credentials.service';

const seed = (s: string) => createHash('sha256').update(s).digest();
const signer = new CredentialSigner(privateKeyFromSeed(seed('test-key')));

describe('canonicalJson', () => {
  it('sorts keys at every depth and drops undefined, so equal claims sign identically', () => {
    assert.equal(canonicalJson({ b: 1, a: { d: [3, { z: 1, y: 2 }], c: undefined } }), '{"a":{"d":[3,{"y":2,"z":1}]},"b":1}');
    assert.equal(canonicalJson({ x: 1, y: 2 }), canonicalJson({ y: 2, x: 1 }));
    assert.throws(() => canonicalJson({ n: Number.NaN }), TypeError);
  });
});

describe('credential codes', () => {
  it('are AST-XXXX-XXXX-XXXX without look-alike characters, and normalise typed input', () => {
    for (let i = 0; i < 200; i++) assert.match(newCredentialCode(), CREDENTIAL_CODE);
    assert.equal(normalizeCode(' ast-7k3m 9q2x-hj4p '), 'AST-7K3M-9Q2X-HJ4P');
    assert.equal(normalizeCode('AST7K3M9Q2XHJ4P'), 'AST-7K3M-9Q2X-HJ4P');
    for (const bad of ['', 'AST-0000-0000-0000', 'AST-ILO1-2345-6789', 'XYZ-7K3M-9Q2X-HJ4P', 'AST-7K3M-9Q2X']) {
      assert.equal(normalizeCode(bad), null, bad);
    }
  });
});

describe('CredentialSigner', () => {
  const { payload, signature, keyId } = signer.sign({ code: 'AST-7K3M-9Q2X-HJ4P', score: 82 });

  it('verifies its own signature and rejects any change to payload, signature or key', () => {
    assert.equal(signer.verify(payload, signature, keyId), true);
    assert.equal(signer.verify(payload.replace('82', '99'), signature, keyId), false);
    assert.equal(signer.verify(payload, `${signature.slice(0, -2)}AA`, keyId), false);
    assert.equal(signer.verify(payload, signature, 'ed25519-0000000000000000'), false);
    const other = new CredentialSigner(privateKeyFromSeed(seed('attacker')));
    const forged = other.sign({ code: 'AST-7K3M-9Q2X-HJ4P', score: 100 });
    assert.equal(signer.verify(forged.payload, forged.signature, keyId), false);
  });

  it('can be checked offline by a third party with only the published JWK', () => {
    const jwk = signer.publicJwk(keyId);
    assert.ok(jwk);
    const pub = createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: jwk.x }, format: 'jwk' });
    assert.equal(edVerify(null, Buffer.from(payload), pub, Buffer.from(signature, 'base64url')), true);
  });

  it('keeps verifying credentials from a retired key after rotation', () => {
    const oldKey = privateKeyFromSeed(seed('old'));
    const old = new CredentialSigner(oldKey);
    const signedByOld = old.sign({ code: 'AST-2222-3333-4444' });
    const rotated = new CredentialSigner(privateKeyFromSeed(seed('new')), [createPublicKey(oldKey)]);
    assert.equal(rotated.verify(signedByOld.payload, signedByOld.signature, signedByOld.keyId), true);
    assert.equal(rotated.jwks().keys.length, 2);
  });

  it('config: production without CREDENTIAL_SIGNING_KEY signs nothing; dev derives a stable key', () => {
    assert.equal(signerFromConfig((k) => ({ NODE_ENV: 'production', JWT_SECRET: 'x'.repeat(32) } as Record<string, string>)[k]), null);
    const a = signerFromConfig((k) => ({ JWT_SECRET: 'x'.repeat(32) } as Record<string, string>)[k]);
    const b = signerFromConfig((k) => ({ JWT_SECRET: 'x'.repeat(32) } as Record<string, string>)[k]);
    assert.equal(a?.keyId, b?.keyId);
  });
});

/** A stored credential row, signed for real. */
function storedRow(opts: { revoked?: boolean; expiresAt?: string | null; tamper?: boolean } = {}) {
  const code = 'AST-7K3M-9Q2X-HJ4P';
  const signed = signer.sign({
    type: 'AsteAICredential', code, kind: 'interview', subject: { userId: 'u1', overallScore: 78 },
    issuedAt: '2026-11-01T00:00:00.000Z', expiresAt: opts.expiresAt ?? null,
  });
  return {
    code, user_id: 'u1', kind: 'interview',
    payload: opts.tamper ? signed.payload.replace('78', '98') : signed.payload,
    signature: signed.signature, key_id: signed.keyId, issued_at: new Date(), expires_at: null,
    revoked_at: opts.revoked ? new Date() : null, revoked_reason: null,
  };
}

describe('CredentialsService.verify (GET /verify/:code)', () => {
  const svcWith = (row: unknown | null) =>
    new CredentialsService(fakeDb([[/FROM credentials WHERE code/, row ? [row] : []]]).pool, signer);

  it('returns the signed claims and a proof anyone can re-check', async () => {
    const out = await svcWith(storedRow()).verify('ast-7k3m-9q2x-hj4p');
    assert.equal(out.valid, true);
    if (!out.valid) return;
    assert.equal(out.code, 'AST-7K3M-9Q2X-HJ4P');
    assert.deepEqual((out.claims.subject as { overallScore: number }).overallScore, 78);
    assert.equal(out.proof.alg, 'EdDSA');
    assert.equal(out.proof.publicKey?.kid, out.proof.keyId);
  });

  it('flags a row edited in the database as bad_signature', async () => {
    assert.deepEqual(await svcWith(storedRow({ tamper: true })).verify('AST-7K3M-9Q2X-HJ4P'),
      { valid: false, code: 'AST-7K3M-9Q2X-HJ4P', reason: 'bad_signature' });
  });

  it('reports revoked, expired and unknown codes, and malformed input without a query', async () => {
    assert.equal((await svcWith(storedRow({ revoked: true })).verify('AST-7K3M-9Q2X-HJ4P') as { reason: string }).reason, 'revoked');
    assert.equal((await svcWith(storedRow({ expiresAt: '2020-01-01T00:00:00.000Z' })).verify('AST-7K3M-9Q2X-HJ4P') as { reason: string }).reason, 'expired');
    assert.equal((await svcWith(null).verify('AST-7K3M-9Q2X-HJ4P') as { reason: string }).reason, 'not_found');
    const db = fakeDb([]);
    assert.deepEqual(await new CredentialsService(db.pool, signer).verify("'; DROP TABLE credentials; --"), { valid: false, code: null, reason: 'not_found' });
    assert.equal(db.log.length, 0);
  });

  it('a credential whose payload names a different code is not valid for this code', async () => {
    const row = storedRow();
    const other = signer.sign({ code: 'AST-2222-3333-4444', kind: 'interview' });
    const out = await svcWith({ ...row, payload: other.payload, signature: other.signature }).verify(row.code);
    assert.equal((out as { reason: string }).reason, 'bad_signature');
  });

  it('issue() stores the exact signed payload and refuses without a key', async () => {
    const db = fakeDb([]);
    const issued = await new CredentialsService(db.pool, signer).issue('u1', 'challenge', { challengeId: 'sum-of-pairs', score: 100 });
    assert.match(issued.code, CREDENTIAL_CODE);
    const [insert] = db.all(/INSERT INTO credentials/);
    const [code, , kind, payload, signature, keyId] = insert.params as string[];
    assert.equal(code, issued.code);
    assert.equal(kind, 'challenge');
    assert.equal(signer.verify(payload, signature, keyId), true);
    assert.equal(JSON.parse(payload).subject.challengeId, 'sum-of-pairs');
    await assert.rejects(new CredentialsService(db.pool, null).issue('u1', 'challenge', {}), ServiceUnavailableException);
  });
});
