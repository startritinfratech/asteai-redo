'use client';

import { useId, useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { clsx } from 'clsx';
import styles from './marketing.module.css';

/** Sends a visitor to the public certificate check at /verify/certificate/[id]. */
export function VerifyCertificateForm() {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState('');

  function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const certificateId = value.trim();
    if (!certificateId) {
      setError('Enter the certificate ID printed on the certificate.');
      return;
    }
    router.push(`/verify/certificate/${encodeURIComponent(certificateId)}`);
  }

  return (
    <form className={styles.verify} onSubmit={onSubmit} noValidate role="search" aria-label="Verify a certificate">
      <label htmlFor={`${id}-input`} className={styles.verifyLabel}>
        Verify a certificate
      </label>
      <p id={`${id}-hint`} className={styles.verifyHint}>
        No account needed. Paste the ID from the certificate&apos;s &ldquo;Verified online at&rdquo; link.
      </p>
      <div className={styles.verifyRow}>
        <input
          id={`${id}-input`}
          className={styles.input}
          value={value}
          onChange={(e) => {
            setValue(e.target.value);
            if (error) setError('');
          }}
          placeholder="Certificate ID"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-hint ${id}-error` : `${id}-hint`}
        />
        <button type="submit" className={clsx(styles.btn, styles.btnPrimary)}>
          Verify
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} className={styles.verifyError} role="alert">
          {error}
        </p>
      )}
    </form>
  );
}
