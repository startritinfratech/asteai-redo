/** Turns the model's per-criterion scores into the structured result (scoring.spec.ts). */
import type { Rubric } from './rubrics';

export type Recommendation = 'strong' | 'ready' | 'developing' | 'not_ready';

export interface ModelCriterionScore {
  key: string;
  score: number;
  evidence: string;
}

export interface CriterionResult {
  key: string;
  label: string;
  weight: number;
  /** 1–5 as judged against the rubric anchors. */
  score: number;
  /** The same on 0–100, for the passport. */
  normalized: number;
  evidence: string;
  competency: string;
}

export interface RubricResult {
  criteria: CriterionResult[];
  /** Weighted 0–100. */
  overall: number;
  recommendation: Recommendation;
  /** Criteria whose gate failed (e.g. trades safety below 3). */
  gatesFailed: string[];
}

export class InvalidModelScoresError extends Error {}

const normalize = (score: number) => Math.round(((score - 1) / 4) * 10_000) / 100;

export function recommendationFor(overall: number): Recommendation {
  if (overall >= 75) return 'strong';
  if (overall >= 60) return 'ready';
  if (overall >= 40) return 'developing';
  return 'not_ready';
}

/**
 * Every rubric criterion must be scored exactly once with an integer 1–5; anything else
 * is rejected (the caller retries) rather than guessed. Unknown keys are ignored.
 */
export function scoreRubric(rubric: Rubric, scores: readonly ModelCriterionScore[]): RubricResult {
  const byKey = new Map<string, ModelCriterionScore>();
  for (const s of scores) {
    if (!rubric.criteria.some((c) => c.key === s.key)) continue;
    if (byKey.has(s.key)) throw new InvalidModelScoresError(`criterion ${s.key} scored twice`);
    byKey.set(s.key, s);
  }

  const criteria: CriterionResult[] = rubric.criteria.map((c) => {
    const s = byKey.get(c.key);
    if (!s) throw new InvalidModelScoresError(`criterion ${c.key} not scored`);
    if (!Number.isInteger(s.score) || s.score < 1 || s.score > 5) {
      throw new InvalidModelScoresError(`criterion ${c.key} scored ${s.score}, expected 1–5`);
    }
    return {
      key: c.key, label: c.label, weight: c.weight, score: s.score, normalized: normalize(s.score),
      evidence: String(s.evidence ?? '').slice(0, 500), competency: c.competency,
    };
  });

  const overall = Math.round(criteria.reduce((sum, c) => sum + c.normalized * c.weight, 0) * 100) / 100;
  const gatesFailed = rubric.criteria
    .filter((c) => c.gateBelow !== undefined && (byKey.get(c.key)?.score ?? 0) < c.gateBelow)
    .map((c) => c.key);

  return {
    criteria,
    overall,
    recommendation: gatesFailed.length ? 'not_ready' : recommendationFor(overall),
    gatesFailed,
  };
}
