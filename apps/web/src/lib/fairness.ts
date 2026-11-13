/**
 * Adverse impact by the 4/5ths (80%) rule: a group's selection rate divided by the
 * highest group's selection rate should be at least 0.8. Groups below that are
 * flagged for review; a group with no candidates has no rate and is not judged.
 */
export const FOUR_FIFTHS = 0.8;

export type ImpactStatus = 'Pass' | 'Review' | 'No data';

export interface GroupInput {
  group: string;
  total: number;
  selected: number;
}

export interface GroupImpact extends GroupInput {
  /** selected / total, 0..1; null when the group has no candidates. */
  rate: number | null;
  /** rate / highest rate; null when it cannot be computed. */
  impactRatio: number | null;
  status: ImpactStatus;
}

export interface ImpactReport {
  groups: GroupImpact[];
  /** 'Review' when any group fails; 'No data' when no group has candidates. */
  overall: ImpactStatus;
}

const toCount = (n: unknown) => {
  const v = Number(n);
  return Number.isFinite(v) && v > 0 ? v : 0;
};

export function fourFifthsReport(rows: readonly GroupInput[]): ImpactReport {
  const withRates = rows.map((r) => {
    const total = toCount(r.total);
    const selected = Math.min(toCount(r.selected), total);
    return { group: r.group, total, selected, rate: total > 0 ? selected / total : null };
  });
  const rated = withRates.filter((r) => r.rate !== null).map((r) => r.rate as number);
  const maxRate = rated.length ? Math.max(...rated) : 0;

  const groups: GroupImpact[] = withRates.map((r) => {
    if (r.rate === null) return { ...r, impactRatio: null, status: 'No data' };
    // Nobody selected in any group: every rate is equal, so there is no disparity.
    const impactRatio = maxRate > 0 ? r.rate / maxRate : 1;
    // Small epsilon so 0.8 computed as 0.7999999 still passes.
    return { ...r, impactRatio, status: impactRatio + 1e-9 >= FOUR_FIFTHS ? 'Pass' : 'Review' };
  });

  const overall: ImpactStatus = !rated.length
    ? 'No data'
    : groups.some((g) => g.status === 'Review')
      ? 'Review'
      : 'Pass';
  return { groups, overall };
}
