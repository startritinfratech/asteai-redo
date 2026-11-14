'use client';

import Link from 'next/link';
import useSWR from 'swr';
import type { ChallengeSummary } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { CAREER_KEYS } from '@/features/career/api';
import styles from '@/features/career/Career.module.css';

const DIFFICULTY_COLOR = { easy: 'mint', medium: 'gold', hard: 'rose' } as const;

export default function ChallengesPage() {
  const { data, error } = useSWR<ChallengeSummary[]>(CAREER_KEYS.challenges, fetcher);
  return (
    <>
      <PageHeader
        eyebrow="Career Studio"
        title="Code Challenges"
        sub="Solve benchmark problems in a sandbox. Your best score per challenge feeds your Talent Passport."
      />
      <Panel className={styles.stack}>
        {error ? <Empty message="Could not load the challenges." /> : !data ? <Empty message="Loading…" /> : !data.length ? (
          <Empty message="No challenges are live yet." />
        ) : (
          <ul className={styles.list}>
            {data.map((c) => (
              <li key={c.id} className={styles.item}>
                <div className={styles.between}>
                  <Link href={`/platform/career/challenges/${encodeURIComponent(c.id)}`} className={styles.link}>{c.title}</Link>
                  <span className={styles.row}>
                    <Tag color={DIFFICULTY_COLOR[c.difficulty]}>{c.difficulty}</Tag>
                    {c.bestScore !== null && <Tag color={c.bestScore >= 100 ? 'mint' : 'default'}>Best {Math.round(c.bestScore)}</Tag>}
                  </span>
                </div>
                <span className={styles.muted}>{c.testCount} tests · {c.languages.join(', ')} · {c.competency.replace(/_/g, ' ')}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
