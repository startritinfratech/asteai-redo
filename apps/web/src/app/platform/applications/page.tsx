'use client';

import Link from 'next/link';
import useSWR from 'swr';
import type { ApplicationStage, ApplicationSummary } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { Empty, Eyebrow, Panel, Tag, type TagColor } from '@/components/ui';
import styles from './applications.module.css';

const STAGE_COLOR: Record<ApplicationStage, TagColor> = {
  Applied: 'grey',
  Eligibility: 'grey',
  'Assessment Pending': 'amber',
  'Assessment Review': 'amber',
  Shortlisted: 'gold',
  Interview: 'gold',
  Offer: 'mint',
  Joined: 'mint',
  Rejected: 'rose',
};

export default function ApplicationsPage() {
  const { data, error, isLoading } = useSWR<ApplicationSummary[]>('/applications/me', fetcher);

  return (
    <div className={styles.page}>
      <Eyebrow>Candidate</Eyebrow>
      <h1>My Applications</h1>

      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={error.message} />}
      {data && data.length === 0 && <Empty message="You haven't applied to any roles yet." />}

      {data && data.length > 0 && (
        <div className={styles.list}>
          {data.map((app) => (
            <Panel key={app.id} className={styles.row}>
              <div className={styles.left}>
                <div className={styles.reqTitle}>{app.requisitionTitle ?? app.requisitionId}</div>
                <div className={styles.meta}>{[app.industry, app.tier].filter(Boolean).join(' · ')}</div>
              </div>
              <div className={styles.right}>
                {!app.resultId && app.stage !== 'Rejected' && (
                  <Link className={styles.action} href={`/platform/assess?req=${encodeURIComponent(app.requisitionId)}`}>
                    Take assessment
                  </Link>
                )}
                <Tag color={STAGE_COLOR[app.stage] ?? 'grey'}>{app.stage}</Tag>
              </div>
            </Panel>
          ))}
        </div>
      )}
    </div>
  );
}
