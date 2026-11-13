'use client';

import Link from 'next/link';
import { Button, Empty, Eyebrow, Panel, Progress } from '@/components/ui';
import { Screen } from './screens';
import { useAssessment } from './useAssessment';
import styles from './assessment.module.css';

/** Runs the role-fit assessment for one requisition the candidate applied to. */
export function AssessmentRunner({ requisitionId, title }: { requisitionId: string; title?: string }) {
  const { item, done, busy, error, fatal, submit, retry } = useAssessment(requisitionId);

  if (done) {
    return (
      <Panel className={styles.stage}>
        <Eyebrow>Submitted</Eyebrow>
        <h2>Your result is sealed.</h2>
        <p>
          The hiring team sees every score with its evidence, and a person, not the system, decides. Your application
          has moved to assessment review.
        </p>
        <div className={styles.row}>
          <Link className={styles.link} href="/platform/applications">Back to my applications</Link>
        </div>
      </Panel>
    );
  }

  if (fatal) {
    return (
      <Panel className={styles.stage}>
        <Eyebrow>Assessment</Eyebrow>
        <p role="alert">{error}</p>
        <div className={styles.row}>
          {!/expired|already completed|not accepting/i.test(error ?? '') && (
            <Button variant="primary" onClick={retry}>Try again</Button>
          )}
          <Link className={styles.link} href="/platform/assess">Back</Link>
        </div>
      </Panel>
    );
  }

  if (!item) return <Empty message="Opening your assessment…" />;

  const { index, total } = item.progress;
  return (
    <Panel className={styles.stage}>
      <div className={styles.top}>
        <span className={styles.meta}>{title ?? 'Role-fit assessment'}</span>
        <span className={styles.meta}>Step {index + 1} of {total}</span>
      </div>
      <Progress value={(index / total) * 100} />
      {error && <p className={styles.error} role="alert">{error}</p>}
      <div className={styles.body} aria-busy={busy}>
        <Screen item={item} submit={submit} busy={busy} />
      </div>
    </Panel>
  );
}
