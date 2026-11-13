'use client';

import { Suspense } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import type { ApplicationSummary } from '@asteai/types';
import { fetcher } from '@/lib/api';
import { Empty, PageHeader, Panel, Tag } from '@/components/ui';
import { AssessmentRunner } from '@/features/assessment';
import styles from './assess.module.css';

/** Applications whose role-fit assessment is still to be taken. */
const pending = (apps: ApplicationSummary[]) => apps.filter((a) => !a.resultId && a.stage !== 'Rejected');

export default function AssessPage() {
  return (
    <Suspense fallback={<Empty message="Loading…" />}>
      <Assess />
    </Suspense>
  );
}

function Assess() {
  const req = useSearchParams().get('req');
  const { data, error, isLoading } = useSWR<ApplicationSummary[]>('/applications/me', fetcher);

  if (req) {
    const app = data?.find((a) => a.requisitionId === req);
    return <AssessmentRunner requisitionId={req} title={app?.requisitionTitle} />;
  }

  const todo = data ? pending(data) : [];
  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Careers & AI Prep"
        title="Take Assessment"
        sub="Each role you apply to has one role-fit assessment: reasoning, working with people, and persistence. Set aside the time shown before you start; you can resume if you get interrupted."
      />
      {isLoading && <Empty message="Loading…" />}
      {error && <Empty message={error.message} />}
      {data && todo.length === 0 && <Empty message="No assessments waiting. Apply to a role first, or check My Applications for results under review." />}
      <div className={styles.list}>
        {todo.map((a) => (
          <Panel key={a.id} className={styles.row}>
            <div className={styles.left}>
              <div className={styles.title}>{a.requisitionTitle ?? a.requisitionId}</div>
              <div className={styles.meta}>{[a.industry, a.tier, TIME[a.tier ?? '']].filter(Boolean).join(' · ')}</div>
            </div>
            <Tag color="amber">{a.stage}</Tag>
            <Link className={styles.start} href={`/platform/assess?req=${encodeURIComponent(a.requisitionId)}`}>
              Start or resume
            </Link>
          </Panel>
        ))}
      </div>
    </div>
  );
}

const TIME: Record<string, string> = {
  Technical: '60–90 min',
  'Non-Technical': '45–60 min',
  Frontline: '15–25 min',
  Skilled: '25–35 min',
};
