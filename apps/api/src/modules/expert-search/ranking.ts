/**
 * Ranking for AI expert search, pure so it is unit-tested (expert-search.spec.ts).
 *
 * fit = 45% domain/skill match + 35% Passport competency + 10% rating + 10% practical fit
 * (availability, engagement, experience). Hard requirements (max hourly rate, minimum
 * years when known) remove an expert instead of lowering the score. Experts with no
 * verified competencies aren't excluded; they just score lower on that part.
 */
import type { AiExpertMatch, ExpertCard, ExpertSearchIntent } from '@asteai/types';

export interface Candidate {
  card: ExpertCard;
  /** Passport competency key → score (0–100). */
  competencies: Record<string, number>;
  overallScore: number | null;
  /** Lowercased free text of headline + summary, for fuzzy skill hits. */
  text: string;
}

const norm = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}+#.]+/gu, ' ').trim();

/** "node" matches "Node.js", "postgres" matches "PostgreSQL": token prefix in either direction. */
export function termMatches(wanted: string, have: string): boolean {
  const a = norm(wanted);
  const b = norm(have);
  if (!a || !b) return false;
  if (a === b) return true;
  const strip = (x: string) => x.replace(/\.js$|js$/, '').replace(/ql$/, '');
  const [sa, sb] = [strip(a), strip(b)];
  return sa.length >= 3 && sb.length >= 3 && (sb.startsWith(sa) || sa.startsWith(sb));
}

function matched(wanted: readonly string[], have: readonly string[], text: string): string[] {
  return wanted.filter((w) => have.some((h) => termMatches(w, h)) || (norm(w).length >= 3 && text.includes(norm(w))));
}

export function passesHardFilters(c: Candidate, intent: ExpertSearchIntent): boolean {
  const e = c.card;
  if (intent.maxHourlyRate !== null && e.hourlyRate !== null) {
    const sameCurrency = !intent.currency || intent.currency.toUpperCase() === e.currency.toUpperCase();
    if (sameCurrency && e.hourlyRate > intent.maxHourlyRate) return false;
  }
  if (intent.minYears !== null && e.yearsExperience !== null && e.yearsExperience < intent.minYears) return false;
  return true;
}

export function scoreCandidate(c: Candidate, intent: ExpertSearchIntent): AiExpertMatch {
  const e = c.card;
  const reasons: string[] = [];

  const skills = matched(intent.skills, e.skills, c.text);
  const domains = matched(intent.domains, e.domains, c.text);
  const wanted = intent.skills.length + intent.domains.length;
  const match = wanted ? (skills.length + domains.length) / wanted : 0.5;
  if (skills.length) reasons.push(`Skills: ${skills.join(', ')}`);
  if (domains.length) reasons.push(`Domain: ${domains.join(', ')}`);

  let competencyScore: number | null = null;
  if (intent.competencies.length) {
    const known = intent.competencies.map((k) => c.competencies[k]).filter((v): v is number => typeof v === 'number');
    if (known.length) {
      // Missing requested competencies count as 0, so partial evidence ranks below full.
      competencyScore = known.reduce((s, v) => s + v, 0) / intent.competencies.length;
      for (const k of intent.competencies) {
        if (typeof c.competencies[k] === 'number') reasons.push(`Passport ${k.replace(/_/g, ' ')} ${Math.round(c.competencies[k])}`);
      }
    }
  } else if (c.overallScore !== null) {
    competencyScore = c.overallScore;
    reasons.push(`Passport score ${Math.round(c.overallScore)}`);
  }

  const rating = e.reviewCount > 0 ? e.rating / 5 : 0.5;
  let practical = 1;
  if (intent.availability && e.availability !== intent.availability) practical -= 0.4;
  if (intent.engagement && !e.engagementModes.includes(intent.engagement)) practical -= 0.4;
  if (intent.minYears !== null && e.yearsExperience === null) practical -= 0.2;
  practical = Math.max(0, practical);
  if (intent.availability && e.availability === intent.availability) reasons.push(`Availability: ${e.availability}`);

  const score = 100 * (0.45 * match + 0.35 * ((competencyScore ?? 0) / 100) + 0.1 * rating + 0.1 * practical);
  return {
    expert: e,
    score: Math.round(score * 10) / 10,
    matchedSkills: skills,
    matchedDomains: domains,
    competencyScore: competencyScore === null ? null : Math.round(competencyScore * 10) / 10,
    reasons,
  };
}

/** Filters, scores and orders candidates (ties: more reviews, then id, so the order is stable). */
export function rankExperts(candidates: readonly Candidate[], intent: ExpertSearchIntent, limit: number): AiExpertMatch[] {
  return candidates
    .filter((c) => passesHardFilters(c, intent))
    .map((c) => scoreCandidate(c, intent))
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score || b.expert.reviewCount - a.expert.reviewCount || a.expert.userId.localeCompare(b.expert.userId))
    .slice(0, limit);
}
