/**
 * Rubrics for AI Interview Studio sessions. The model scores each criterion 1–5 against
 * these anchors and quotes its evidence; the overall score, the recommendation and the
 * safety gate are computed here (scoring.ts), never by the model.
 */

export type InterviewMode = 'technical' | 'trades_voice';
export const INTERVIEW_MODES: readonly InterviewMode[] = ['technical', 'trades_voice'];

export interface RubricCriterion {
  key: string;
  label: string;
  /** Weights of a rubric sum to 1. */
  weight: number;
  /** Talent Passport competency this criterion feeds. */
  competency: string;
  anchors: Record<1 | 3 | 5, string>;
  /** Below this score the candidate is "not ready" whatever the total (trades safety). */
  gateBelow?: number;
}

export interface Rubric {
  mode: InterviewMode;
  maxQuestions: number;
  minAnswersToScore: number;
  criteria: RubricCriterion[];
}

export const RUBRICS: Record<InterviewMode, Rubric> = {
  technical: {
    mode: 'technical',
    maxQuestions: 8,
    minAnswersToScore: 3,
    criteria: [
      {
        key: 'problem_solving', label: 'Problem solving', weight: 0.3, competency: 'problem_solving',
        anchors: { 1: 'Cannot structure an approach.', 3: 'Reaches a workable approach with prompting; misses some edge cases.', 5: 'Structures the problem, compares options, covers edge cases unprompted.' },
      },
      {
        key: 'technical_depth', label: 'Technical depth', weight: 0.3, competency: 'technical_depth',
        anchors: { 1: 'Buzzwords without understanding.', 3: 'Correct working knowledge of the main tools.', 5: 'Explains internals and why, not just how; knows the limits.' },
      },
      {
        key: 'system_design', label: 'System design & trade-offs', weight: 0.2, competency: 'system_design',
        anchors: { 1: 'No sense of scale, failure or trade-offs.', 3: 'Sensible design; names some trade-offs.', 5: 'Designs for scale and failure; weighs trade-offs explicitly.' },
      },
      {
        key: 'communication', label: 'Communication', weight: 0.2, competency: 'communication',
        anchors: { 1: 'Hard to follow.', 3: 'Clear enough; occasionally rambles.', 5: 'Concise, structured, checks understanding.' },
      },
    ],
  },
  trades_voice: {
    mode: 'trades_voice',
    maxQuestions: 6,
    minAnswersToScore: 3,
    criteria: [
      {
        key: 'safety_compliance', label: 'Safety & compliance', weight: 0.35, competency: 'safety_compliance', gateBelow: 3,
        anchors: { 1: 'Unsafe or unaware of basic safety rules.', 3: 'Knows the main rules and protective equipment.', 5: 'Puts safety first unprompted: permits, lock-out, reporting, stopping work.' },
      },
      {
        key: 'procedural_knowledge', label: 'Procedural knowledge', weight: 0.25, competency: 'procedural_knowledge',
        anchors: { 1: 'Does not know the steps of the job.', 3: 'Knows the usual steps in roughly the right order.', 5: 'Precise, ordered procedure including checks and hand-overs.' },
      },
      {
        key: 'situational_judgement', label: 'Situational judgement', weight: 0.2, competency: 'situational_judgement',
        anchors: { 1: 'Freezes or acts dangerously when things go wrong.', 3: 'Reasonable response; escalates when unsure.', 5: 'Calm, correct response to faults and emergencies; protects people first.' },
      },
      {
        key: 'equipment_knowledge', label: 'Equipment & tools', weight: 0.1, competency: 'equipment_knowledge',
        anchors: { 1: 'Cannot name the equipment or its checks.', 3: 'Knows the equipment and daily checks.', 5: 'Knows limits, faults and maintenance of the equipment.' },
      },
      {
        key: 'communication', label: 'Communication', weight: 0.1, competency: 'communication',
        anchors: { 1: 'Cannot explain what they would do.', 3: 'Understandable; some gaps.', 5: 'Clear, confident, would brief a team well.' },
      },
    ],
  },
};
