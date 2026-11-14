import {
  Inject, Injectable, Logger, NotFoundException, Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import type { CredentialKind, IssuedCredential, VerificationResult } from '@asteai/types';
import { CredentialSigner, newCredentialCode, normalizeCode } from './credential-signer';

export type { CredentialKind, IssuedCredential, VerificationResult };

export const CREDENTIAL_SIGNER = 'CREDENTIAL_SIGNER';

type Db = Pick<Pool | PoolClient, 'query'>;

interface CredentialRow {
  code: string;
  user_id: string;
  kind: CredentialKind;
  payload: string;
  signature: string;
  key_id: string;
  issued_at: Date;
  expires_at: Date | null;
  revoked_at: Date | null;
  revoked_reason: string | null;
}

/**
 * Signed, revocable credentials (passport snapshots, challenge passes, interview results).
 * The claims are frozen at issue time; the passport itself keeps changing.
 */
@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    @Optional() @Inject(CREDENTIAL_SIGNER) private readonly signer: CredentialSigner | null,
  ) {}

  /**
   * Signs and stores a credential. `subject` holds the claims (no secrets, nothing the
   * holder would not show an employer). Pass `db` to issue inside a caller's transaction.
   */
  async issue(
    userId: string, kind: CredentialKind, subject: Record<string, unknown>,
    opts: { validForDays?: number; db?: Db } = {},
  ): Promise<IssuedCredential> {
    if (!this.signer) throw new ServiceUnavailableException('Credential signing is not configured');
    const db = opts.db ?? this.db;
    const issuedAt = new Date();
    const expiresAt = opts.validForDays ? new Date(issuedAt.getTime() + opts.validForDays * 86_400_000) : null;

    // A code collision is astronomically unlikely; retry anyway rather than fail.
    for (let attempt = 0; attempt < 3; attempt++) {
      const code = newCredentialCode();
      const signed = this.signer.sign({
        type: 'AsteAICredential',
        version: 1,
        code,
        kind,
        issuer: 'asteai',
        subject: { userId, ...subject },
        issuedAt: issuedAt.toISOString(),
        expiresAt: expiresAt?.toISOString() ?? null,
      });
      try {
        await db.query(
          `INSERT INTO credentials (code, user_id, kind, payload, signature, key_id, issued_at, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [code, userId, kind, signed.payload, signed.signature, signed.keyId, issuedAt, expiresAt],
        );
        return {
          code, kind, issuedAt: issuedAt.toISOString(), expiresAt: expiresAt?.toISOString() ?? null, verifyPath: `/verify/${code}`,
        };
      } catch (err) {
        if (!isUniqueViolation(err)) throw err;
      }
    }
    throw new Error('Could not allocate a credential code');
  }

  /**
   * Public check. The stored payload is re-verified against its signature on every call,
   * so a row edited in the database (or a forged one) reads as `bad_signature`.
   */
  async verify(rawCode: string): Promise<VerificationResult> {
    const code = normalizeCode(rawCode ?? '');
    if (!code) return { valid: false, code: null, reason: 'not_found' };
    if (!this.signer) return { valid: false, code, reason: 'unavailable' };

    const { rows } = await this.db.query<CredentialRow>(`SELECT * FROM credentials WHERE code = $1`, [code]);
    const row = rows[0];
    if (!row) return { valid: false, code, reason: 'not_found' };
    if (!this.signer.verify(row.payload, row.signature, row.key_id)) {
      this.logger.error(`Credential ${code} failed signature verification`);
      return { valid: false, code, reason: 'bad_signature' };
    }
    let claims: Record<string, unknown>;
    try {
      claims = JSON.parse(row.payload) as Record<string, unknown>;
    } catch {
      return { valid: false, code, reason: 'bad_signature' };
    }
    // The signed claims, not the row's columns, decide what the credential says.
    if (claims.code !== code) return { valid: false, code, reason: 'bad_signature' };
    if (row.revoked_at) return { valid: false, code, reason: 'revoked' };
    const expires = typeof claims.expiresAt === 'string' ? new Date(claims.expiresAt) : null;
    if (expires && expires.getTime() < Date.now()) return { valid: false, code, reason: 'expired' };

    return {
      valid: true,
      code,
      kind: row.kind,
      claims,
      proof: {
        alg: 'EdDSA', keyId: row.key_id, payload: row.payload, signature: row.signature,
        publicKey: this.signer.publicJwk(row.key_id),
      },
      verifiedAt: new Date().toISOString(),
    };
  }

  jwks() {
    if (!this.signer) throw new ServiceUnavailableException('Credential signing is not configured');
    return this.signer.jwks();
  }

  async listMine(userId: string) {
    const { rows } = await this.db.query<CredentialRow>(
      `SELECT code, kind, issued_at, expires_at, revoked_at, revoked_reason FROM credentials
        WHERE user_id = $1 ORDER BY issued_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map((r) => ({
      code: r.code, kind: r.kind, issuedAt: r.issued_at, expiresAt: r.expires_at,
      revokedAt: r.revoked_at, verifyPath: `/verify/${r.code}`,
    }));
  }

  /** The holder withdraws a credential they shared. Idempotent. */
  async revoke(userId: string, rawCode: string, reason = 'revoked by holder'): Promise<{ code: string; revoked: true }> {
    const code = normalizeCode(rawCode ?? '');
    if (!code) throw new NotFoundException('Credential not found');
    const { rowCount } = await this.db.query(
      `UPDATE credentials SET revoked_at = COALESCE(revoked_at, NOW()), revoked_reason = COALESCE(revoked_reason, $3)
        WHERE code = $1 AND user_id = $2`,
      [code, userId, reason.slice(0, 200)],
    );
    if (!rowCount) throw new NotFoundException('Credential not found');
    return { code, revoked: true };
  }
}
