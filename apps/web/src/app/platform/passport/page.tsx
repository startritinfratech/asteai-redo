'use client';

import useSWR from 'swr';
import { fetcher } from '@/lib/api';
import { Tag, Eyebrow, Empty, KPI } from '@/components/ui';
import type { Passport } from '@asteai/types';
import styles from './passport.module.css';

export default function PassportPage() {
  const { data: passports, error, isLoading } = useSWR<Passport[]>('/passports/me', fetcher);

  return (
    <div className={styles.page}>
      <Eyebrow>Talent Passport</Eyebrow>
      <h1>My Passports</h1>

      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={error.message} />}

      {passports && passports.map((p) => (
        <PassportCard key={p.id} passport={p} />
      ))}

      {passports && passports.length === 0 && (
        <Empty message="Complete an assessment to earn your Talent Passport." />
      )}
    </div>
  );
}

function PassportCard({ passport: p }: { passport: Passport }) {
  const isValid = p.status === 'Valid';
  return (
    <div className={styles.card}>
      <div className={styles.glow} />
      <div className={styles.top}>
        <div>
          <Eyebrow>{p.tier} Track</Eyebrow>
          <h2>{p.name}</h2>
        </div>
        <Tag color={isValid ? 'mint' : 'rose'}>{p.status}</Tag>
      </div>

      <div className={styles.scores}>
        {p.scores.map(([label, score]) => (
          <div key={label} className={styles.scoreRow}>
            <span className={styles.scoreLabel}>{label}</span>
            <div className={styles.scoreBar}>
              <div className={styles.scoreFill} style={{ width: `${score}%` }} />
            </div>
            <span className={styles.scoreVal}>{score}</span>
          </div>
        ))}
      </div>

      <div className={styles.stens}>
        <StenItem label="IQ" value={p.sten.iq} />
        <StenItem label="EQ" value={p.sten.eq} />
        <StenItem label="Grit" value={p.sten.grit} />
      </div>

      <div className={styles.footer}>
        <KPI value={`${p.percentile}th`} label="Percentile" />
        <KPI value={new Date(p.issuedAt).toLocaleDateString('en-IN')} label="Issued" />
        <KPI value={p.validUntil ? new Date(p.validUntil).toLocaleDateString('en-IN') : '—'} label="Valid until" />
        <div className={styles.hash}>{p.hash}</div>
      </div>

      <div className={styles.verifs}>
        {p.verifications.map((v) => (
          <span key={`${v.t}-${v.by}`} className={styles.verif}>✓ Verified by {v.by}</span>
        ))}
      </div>
    </div>
  );
}

function StenItem({ label, value }: { label: string; value?: number }) {
  const pct = ((value ?? 5.5) / 10) * 100;
  return (
    <div className={styles.sten}>
      <span className={styles.stenLabel}>{label}</span>
      <div className={styles.stenTrack}>
        <div className={styles.stenFill} style={{ left: `${pct - 2}%` }} />
      </div>
      <span className={styles.stenVal}>{value ?? '—'}</span>
    </div>
  );
}
