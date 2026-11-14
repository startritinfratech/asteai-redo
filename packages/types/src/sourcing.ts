// ─── Talent sourcing & SOW ────────────────────────────────────────────────────
// POST /experts/ai-search and proposal statements of work. Shared by API and web.

import type { Availability, EngagementMode, ExpertCard } from './profile';

/** Talent Passport competency keys the search can ask for (competency_benchmarks). */
export const SEARCHABLE_COMPETENCIES = [
  'algorithms', 'problem_solving', 'technical_depth', 'system_design', 'communication',
  'safety_compliance', 'procedural_knowledge', 'situational_judgement', 'equipment_knowledge',
] as const;
export type SearchableCompetency = (typeof SEARCHABLE_COMPETENCIES)[number];

/** What the AI understood the buyer to want. Every field is optional in effect (empty = no preference). */
export interface ExpertSearchIntent {
  /** One line restating the need, in English. */
  summary: string;
  skills: string[];
  domains: string[];
  competencies: SearchableCompetency[];
  minYears: number | null;
  /** In `currency`, per hour; experts above it are left out. */
  maxHourlyRate: number | null;
  currency: string | null;
  availability: Availability | null;
  engagement: EngagementMode | null;
  location: string | null;
  languages: string[];
}

export interface AiExpertMatch {
  expert: ExpertCard;
  /** 0–100 overall fit. */
  score: number;
  matchedSkills: string[];
  matchedDomains: string[];
  /** Mean Passport score over the requested competencies (or the expert's overall), 0–100; null when unverified. */
  competencyScore: number | null;
  /** Short, human reasons for the ranking ("Passport system design 86"). */
  reasons: string[];
}

export interface AiExpertSearchResponse {
  intent: ExpertSearchIntent;
  results: AiExpertMatch[];
  /** Vetted experts considered before ranking. */
  considered: number;
  credits: { charged: number; balance: number };
}

// ── Statement of work (on a proposal) ──

export interface SowMilestone {
  title: string;
  amount: number;
  /** Days after the contract starts. */
  dueInDays: number;
  acceptanceCriteria: string[];
}

export interface StatementOfWork {
  scope: string;
  deliverables: string[];
  milestones: SowMilestone[];
  assumptions: string[];
  outOfScope: string[];
  revisionRounds: number;
}
