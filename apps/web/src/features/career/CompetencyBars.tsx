import type { CompetencyView } from '@asteai/types';
import { Tag } from '@/components/ui';
import { barWidth, groupCompetencies, percentileLabel, scoreBand } from './format';
import styles from './Career.module.css';

/** Competency scores as labelled bars, grouped (technical / trades / core). */
export function CompetencyBars({ competencies }: { competencies: readonly CompetencyView[] }) {
  if (!competencies.length) return <p className={styles.muted}>No verified competencies yet.</p>;
  return (
    <div className={styles.bars}>
      {groupCompetencies(competencies).map(([group, list]) => (
        <div key={group} className={styles.stack}>
          <p className={styles.groupLabel}>{group}</p>
          {list.map((c) => {
            const band = scoreBand(c.score);
            return (
              <div key={c.key} className={styles.bar}>
                <span className={styles.row}>
                  <span>{c.label}</span>
                  <Tag color={band.color}>{band.label}</Tag>
                </span>
                <span className={styles.barValue}>{Math.round(c.score)}</span>
                <div
                  className={styles.barTrack}
                  role="meter"
                  aria-label={c.label}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(c.score)}
                  aria-valuetext={`${Math.round(c.score)} out of 100, ${percentileLabel(c.percentile)}`}
                >
                  <span className={styles.barFill} style={{ width: barWidth(c.score) }} />
                </div>
                <span className={`${styles.muted} ${styles.small}`}>
                  {percentileLabel(c.percentile)} · {c.evidenceCount} verified {c.evidenceCount === 1 ? 'result' : 'results'}
                </span>
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
}
