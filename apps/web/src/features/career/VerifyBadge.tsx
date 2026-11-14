'use client';

import { useEffect, useState } from 'react';
import type { VerificationResult } from '@asteai/types';
import { careerApi } from './api';
import { credentialBelongs, verificationMessage } from './format';
import { verifyProofLocally } from './verifyProof';
import styles from './Passport.module.css';

type State =
  | { kind: 'checking' }
  | { kind: 'done'; result: VerificationResult; local: boolean | null }
  | { kind: 'error' };

/**
 * Live verification of one credential code: the API's check, an in-browser signature
 * check, and that the credential is this passport's (`slug` / `knownCodes`).
 */
export function VerifyBadge({ code, slug, knownCodes }: { code: string; slug: string; knownCodes: readonly string[] }) {
  const [state, setState] = useState<State>({ kind: 'checking' });
  const [showProof, setShowProof] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const result = await careerApi.verify(code);
        const local = result.valid ? await verifyProofLocally(result.proof) : null;
        if (live) setState({ kind: 'done', result, local });
      } catch {
        if (live) setState({ kind: 'error' });
      }
    })();
    return () => { live = false; };
  }, [code]);

  if (state.kind === 'checking') {
    return <div className={`${styles.badge} ${styles.badgeChecking}`} role="status">Verifying {code}…</div>;
  }
  if (state.kind === 'error') {
    return <div className={`${styles.badge} ${styles.badgeBad}`} role="status">Could not reach the verification service.</div>;
  }

  const { result, local } = state;
  const belongs = credentialBelongs(result, slug, knownCodes);
  const ok = result.valid && local !== false && belongs;
  return (
    <div className={styles.verify}>
      <div className={`${styles.badge} ${ok ? styles.badgeOk : styles.badgeBad}`} role="status">
        <span aria-hidden="true">{ok ? '✓' : '✕'}</span>
        <span>
          <strong>{ok ? 'Verified credential' : 'Not verified'}</strong>
          <span className={styles.badgeSub}>
            {local === false ? 'The signature does not match the published key: do not trust this credential'
              : result.valid && !belongs ? 'This is a valid credential, but it was not issued to this passport'
              : result.valid ? `${verificationMessage(result)}${local ? ' on this device' : ''} · Ed25519 · ${result.proof.keyId}`
                : verificationMessage(result)}
          </span>
        </span>
      </div>
      <p className={styles.code}>Code <span>{code}</span></p>
      {result.valid && belongs && (
        <>
          <button type="button" className={styles.proofToggle} aria-expanded={showProof} onClick={() => setShowProof((v) => !v)}>
            {showProof ? 'Hide proof' : 'Show cryptographic proof'}
          </button>
          {showProof && (
            <dl className={styles.proof}>
              <dt>Signed payload</dt><dd><code>{result.proof.payload}</code></dd>
              <dt>Signature (base64url)</dt><dd><code>{result.proof.signature}</code></dd>
              <dt>Public key (JWK x)</dt><dd><code>{result.proof.publicKey?.x ?? 'unavailable'}</code></dd>
              <dt>Verified at</dt><dd>{new Date(result.verifiedAt).toLocaleString()}</dd>
            </dl>
          )}
        </>
      )}
    </div>
  );
}
