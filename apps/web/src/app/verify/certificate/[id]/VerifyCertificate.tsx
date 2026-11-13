'use client';

/** Public: where a certificate's "Verified online at" link lands. No login needed. */
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { api } from '@/lib/api';
import styles from './verify.module.css';

interface Verification {
  valid: boolean;
  message?: string;
  certificateId?: string;
  candidateName?: string;
  certificateTitle?: string;
  recommendation?: string | null;
  domainsDemonstrated?: string[];
  interviewDate?: string;
  verifiedAt?: string;
}

export default function VerifyCertificatePage() {
  const { id } = useParams<{ id: string }>();
  const { data, error, isLoading } = useSWR(id ? `/certificates/verify/${id}` : null, (url: string) =>
    api.get<Verification>(url),
  );

  return (
    <main className={styles.wrap}>
      <div className={styles.card}>
        <div className={styles.brand}>ASTEAI · Certificate check</div>
        {isLoading && <p className={styles.dim}>Checking…</p>}
        {error && <p className={styles.bad}>The check could not be completed. Please try again.</p>}
        {data && !data.valid && (
          <>
            <h1 className={styles.bad}>Not verified</h1>
            <p className={styles.dim}>{data.message ?? 'No certificate matches this link.'}</p>
          </>
        )}
        {data?.valid && (
          <>
            <h1 className={styles.good}>✓ Genuine certificate</h1>
            <dl className={styles.facts}>
              <dt>Awarded to</dt><dd>{data.candidateName}</dd>
              <dt>Certificate</dt><dd>{data.certificateTitle}</dd>
              {data.recommendation && (<><dt>Outcome</dt><dd>{data.recommendation}</dd></>)}
              {data.domainsDemonstrated && data.domainsDemonstrated.length > 0 && (
                <><dt>Demonstrated</dt><dd>{data.domainsDemonstrated.join(', ')}</dd></>
              )}
              {data.interviewDate && (
                <><dt>Interview date</dt><dd>{new Date(data.interviewDate).toLocaleDateString('en-IN', { dateStyle: 'long' })}</dd></>
              )}
              <dt>Certificate ID</dt><dd className={styles.mono}>{data.certificateId}</dd>
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
