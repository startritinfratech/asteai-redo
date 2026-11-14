/**
 * Talent Passport arithmetic, pure so it is tested without a database (scoring.spec.ts).
 *
 * A competency score is the weighted mean of the BEST score per evidence item (one
 * challenge, one interview), so retrying a challenge can only raise it and one lucky item
 * can't outweigh several solid ones. Interviews weigh more than single challenges.
 * Confidence grows with the amount of evidence and reaches 1 at a weight of 4.
 */

export type EvidenceSource = 'challenge' | 'interview' | 'assessment';

export const SOURCE_WEIGHT: Record<EvidenceSource, number> = { challenge: 1, interview: 1.5, assessment: 1 };
const FULL_CONFIDENCE_WEIGHT = 4;

export interface EvidenceItem {
  source: EvidenceSource;
  refId: string;
  score: number;
}

export interface CompetencyAggregate {
  score: number;
  confidence: number;
  /** Distinct evidence items (best attempt each). */
  evidenceCount: number;
}

const round = (n: number, dp: number) => Math.round(n * 10 ** dp) / 10 ** dp;
const clamp = (n: number) => Math.min(100, Math.max(0, n));

export function aggregateCompetency(evidence: readonly EvidenceItem[]): CompetencyAggregate | null {
  const best = new Map<string, { source: EvidenceSource; score: number }>();
  for (const e of evidence) {
    if (!Number.isFinite(e.score)) continue;
    const key = `${e.source}:${e.refId}`;
    const prev = best.get(key);
    if (!prev || e.score > prev.score) best.set(key, { source: e.source, score: clamp(e.score) });
  }
  if (!best.size) return null;
  let sum = 0;
  let weight = 0;
  for (const { source, score } of best.values()) {
    sum += score * SOURCE_WEIGHT[source];
    weight += SOURCE_WEIGHT[source];
  }
  return {
    score: round(sum / weight, 2),
    confidence: round(Math.min(1, weight / FULL_CONFIDENCE_WEIGHT), 2),
    evidenceCount: best.size,
  };
}

/** The passport's headline number: competency scores weighted by their confidence. */
export function overallScore(scores: readonly { score: number; confidence: number }[]): number | null {
  let sum = 0;
  let weight = 0;
  for (const s of scores) {
    const w = Math.max(0.1, s.confidence); // a single item still counts a little
    sum += s.score * w;
    weight += w;
  }
  return weight ? round(sum / weight, 2) : null;
}

/**
 * Percentile against everyone else holding the competency: the share scoring below, with
 * ties counted half (so equal scores land in the middle). Null with nobody to compare to.
 */
export function percentileFromCounts(below: number, equal: number, others: number): number | null {
  if (others <= 0) return null;
  return round(((below + equal / 2) / others) * 100, 1);
}

const RESERVED_SLUGS = new Set(['me', 'verify', 'benchmarks', 'admin', 'new', 'edit']);
export const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9-]{1,38})[a-z0-9]$/;

export function isValidSlug(slug: string): boolean {
  return SLUG_PATTERN.test(slug) && !slug.includes('--') && !RESERVED_SLUGS.has(slug) && !slug.startsWith('pass-');
}

/** `Priya Menon` → `priya-menon-k7q2`; the suffix keeps common names unique. */
export function suggestSlug(name: string, suffix: string): string {
  const base = name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
    .slice(0, 30).replace(/-+$/g, '');
  return `${base.length >= 2 ? base : 'talent'}-${suffix}`;
}
