'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { Button, Eyebrow, Empty, Tag, PageHeader, CertCard, Hash } from '@/components/ui';
import { errorMessage } from '@/lib/api';
import { interviewsApi, downloadCertificate, toNumber } from '@/lib/interviews';
import styles from '../studio/studio.module.css';

export default function CertificatesPage() {
  const { data, isLoading } = useSWR('/interviews/mock', () => interviewsApi.list());
  const done = (data ?? []).filter((i) => i.status === 'completed');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const download = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      await downloadCertificate(id);
    } catch (e) {
      setError(errorMessage(e, 'Download failed'));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Careers & AI Prep"
        title="Digital Certificates"
        sub="One for every completed AI interview, each with its own ID that anyone can check online."
      />
      {error && <div className={styles.error}>{error}</div>}
      {isLoading && <Empty message="Loading…" />}
      {!isLoading && done.length === 0 && (
        <Empty message="No certificates yet. Complete an interview in the AI Interview Studio to earn one." />
      )}
      <div className={styles.g2}>
        {done.map((i) => {
          const score = toNumber(i.overall_score);
          return (
            <CertCard key={i.id}>
              <Eyebrow>Certificate</Eyebrow>
              <b style={{ fontFamily: 'var(--font-display)', fontSize: '1.05rem' }}>{i.skill}</b>
              <span className={`${styles.small} ${styles.muted}`}>
                {i.domain.replace(' (Frontline)', '')} · Issued {new Date(i.completed_at ?? i.started_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })}
                {score !== null && ` · Score ${Math.round(score)}`}
              </span>
              <Hash>{i.id}</Hash>
              <div className={styles.row}>
                <Tag color="mint">Verifiable</Tag>
                <span style={{ marginLeft: 'auto' }} />
                <Link href={`/platform/studio/${i.id}`} className={styles.small}>Report</Link>
                <Button variant="sm" onClick={() => download(i.id)} disabled={busy === i.id}>
                  {busy === i.id ? 'Preparing…' : 'Download PDF'}
                </Button>
              </div>
            </CertCard>
          );
        })}
      </div>
    </div>
  );
}
