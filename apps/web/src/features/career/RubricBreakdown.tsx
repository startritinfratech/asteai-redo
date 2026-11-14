import Link from 'next/link';
import type { IssuedCredential, StudioMode, StudioRubricResult } from '@asteai/types';
import { Panel, Tag } from '@/components/ui';
import { RECOMMENDATION_LABEL } from './format';
import styles from './Career.module.css';

/** Post-interview result: overall, recommendation, and each rubric criterion with its evidence. */
export function RubricBreakdown({ rubric, mode, credential, passportSlug }: {
  rubric: StudioRubricResult;
  mode: StudioMode;
  credential?: IssuedCredential | null;
  passportSlug?: string | null;
}) {
  const rec = RECOMMENDATION_LABEL[rubric.recommendation];
  return (
    <div className={styles.stack}>
      <Panel className={styles.stack}>
        <div className={styles.between}>
          <div className={styles.stack}>
            <span className={styles.muted}>Overall</span>
            <span className={styles.bigScore}>{Math.round(rubric.overall)}<span className={styles.muted}> / 100</span></span>
          </div>
          <Tag color={rec.color}>{rec.label}</Tag>
        </div>
        {rubric.gatesFailed.includes('safety_compliance') && (
          <p className={styles.notice} role="note">
            Safety & compliance scored below 3 of 5. For trades and railway roles that means &ldquo;not ready yet&rdquo;
            whatever the total: review the safety rules for this role and try again.
          </p>
        )}
        {rubric.summary && <p className={styles.problem}>{rubric.summary}</p>}
        {credential && (
          <p className={styles.ok}>
            Signed credential <span className={styles.mono}>{credential.code}</span>
            {passportSlug && <> · <Link href={`/passport/${passportSlug}?credential=${credential.code}`} className={styles.link}>verify it</Link></>}
          </p>
        )}
      </Panel>

      <Panel className={styles.stack}>
        <h2 className={styles.h2}>{mode === 'trades_voice' ? 'Trades rubric' : 'Technical rubric'}</h2>
        <div className={styles.rubric}>
          {rubric.criteria.map((c) => (
            <div key={c.key} className={styles.criterion}>
              <div className={styles.between}>
                <strong>{c.label}</strong>
                <span className={styles.row}>
                  <span className={styles.dots} role="img" aria-label={`${c.score} out of 5`}>
                    {[1, 2, 3, 4, 5].map((n) => <span key={n} className={n <= c.score ? `${styles.dot} ${styles.dotOn}` : styles.dot} />)}
                  </span>
                  <span className={`${styles.muted} ${styles.small}`}>weight {Math.round(c.weight * 100)}%</span>
                </span>
              </div>
              {c.evidence && <p className={styles.quote}>{c.evidence}</p>}
            </div>
          ))}
        </div>
      </Panel>

      {(rubric.strengths.length > 0 || rubric.improvements.length > 0) && (
        <div className={styles.grid}>
          {rubric.strengths.length > 0 && (
            <Panel className={styles.stack}>
              <h3 className={styles.h3}>What went well</h3>
              <ul className={styles.list}>{rubric.strengths.map((s) => <li key={s}>{s}</li>)}</ul>
            </Panel>
          )}
          {rubric.improvements.length > 0 && (
            <Panel className={styles.stack}>
              <h3 className={styles.h3}>To work on</h3>
              <ul className={styles.list}>{rubric.improvements.map((s) => <li key={s}>{s}</li>)}</ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
