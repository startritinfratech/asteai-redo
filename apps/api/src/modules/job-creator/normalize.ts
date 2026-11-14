/**
 * Turns whatever the model returned into a valid GeneratedJob (normalize.spec.ts):
 * bounded lists, valid question types, and weights that are whole numbers summing to
 * exactly 100, so the result can go straight into POST /requisitions.
 */
import {
  JOB_BANDS, type GeneratedJob, type JobBand, type JobRubricCriterion, type ScreeningQuestion, type ScreeningQuestionType,
} from '@asteai/types';

const clip = (v: unknown, n: number) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim().slice(0, n) : '');
const list = (v: unknown, max: number, len: number) =>
  [...new Set((Array.isArray(v) ? v : []).map((x) => clip(x, len)).filter(Boolean))].slice(0, max);
const QUESTION_TYPES: ScreeningQuestionType[] = ['yes_no', 'short_text', 'multiple_choice', 'number'];

/**
 * Largest-remainder rounding: positive whole numbers proportional to `raw` that add up
 * to exactly `total` (each at least 1 when there is room).
 */
export function apportion(raw: readonly number[], total = 100): number[] {
  if (!raw.length) return [];
  const clean = raw.map((x) => (Number.isFinite(x) && x > 0 ? x : 0));
  const sum = clean.reduce((a, b) => a + b, 0);
  const shares = sum > 0 ? clean.map((x) => (x / sum) * total) : clean.map(() => total / raw.length);
  const out = shares.map((s) => Math.floor(s));
  let left = total - out.reduce((a, b) => a + b, 0);
  const order = shares.map((s, i) => ({ i, r: s - Math.floor(s) })).sort((a, b) => b.r - a.r || a.i - b.i);
  for (let k = 0; left > 0; k = (k + 1) % order.length, left--) out[order[k].i]++;
  // No zero-weight criteria: take from the largest until every entry has at least 1.
  if (total >= raw.length) {
    for (let i = 0; i < out.length; i++) {
      while (out[i] < 1) {
        const big = out.indexOf(Math.max(...out));
        out[big]--;
        out[i]++;
      }
    }
  }
  return out;
}

function question(raw: unknown): ScreeningQuestion | null {
  const q = (raw ?? {}) as Partial<ScreeningQuestion>;
  const text = clip(q.question, 300);
  if (text.length < 5) return null;
  let type: ScreeningQuestionType = QUESTION_TYPES.includes(q.type as ScreeningQuestionType) ? (q.type as ScreeningQuestionType) : 'short_text';
  let options = type === 'multiple_choice' ? list(q.options, 8, 120) : [];
  if (type === 'multiple_choice' && options.length < 2) {
    type = 'short_text';
    options = [];
  }
  return { question: text, type, options, knockout: q.knockout === true, idealAnswer: clip(q.idealAnswer, 500) };
}

export interface GenerateInput {
  rolePrompt: string;
  stack: string[];
  band: JobBand;
  questionCount: number;
}

export function normalizeGeneratedJob(raw: unknown, input: GenerateInput): GeneratedJob {
  const r = (raw ?? {}) as Partial<GeneratedJob> & Record<string, unknown>;
  const band = (r.band ?? {}) as Partial<GeneratedJob['band']>;
  const yearsMin = Number.isFinite(band.yearsMin) ? Math.max(0, Math.min(40, Math.round(band.yearsMin as number))) : 0;
  const yearsMaxRaw = Number.isFinite(band.yearsMax) ? Math.round(band.yearsMax as number) : null;

  const rubricRaw = (Array.isArray(r.evaluationRubric) ? r.evaluationRubric : [])
    .map((c) => c as Partial<JobRubricCriterion>)
    .filter((c) => clip(c.criterion, 120).length >= 2)
    .slice(0, 10);
  const weights = apportion(rubricRaw.map((c) => Number(c.weight)));
  const rubric: JobRubricCriterion[] = rubricRaw.map((c, i) => ({
    criterion: clip(c.criterion, 120),
    weight: weights[i],
    strongSignals: list(c.strongSignals, 6, 200),
    weakSignals: list(c.weakSignals, 6, 200),
  }));

  const sw = (r.suggestedWeights ?? {}) as Partial<GeneratedJob['suggestedWeights']>;
  const [iq, eq, grit] = apportion([Number(sw.iq), Number(sw.eq), Number(sw.grit)]);

  return {
    title: clip(r.title, 200) || clip(input.rolePrompt, 80),
    summary: clip(r.summary, 1500),
    band: {
      // The caller chose the band; the model only fills in the wording and years.
      level: input.band,
      label: clip(band.label, 60) || input.band,
      yearsMin,
      yearsMax: yearsMaxRaw === null ? null : Math.max(yearsMin, Math.min(50, yearsMaxRaw)),
    },
    responsibilities: list(r.responsibilities, 10, 300),
    requirements: {
      mustHave: list(r.requirements?.mustHave, 10, 200),
      niceToHave: list(r.requirements?.niceToHave, 8, 200),
    },
    stack: list([...input.stack, ...(Array.isArray(r.stack) ? r.stack : [])], 30, 80),
    screeningQuestions: (Array.isArray(r.screeningQuestions) ? r.screeningQuestions : [])
      .map(question).filter((q): q is ScreeningQuestion => q !== null).slice(0, input.questionCount),
    evaluationRubric: rubric,
    suggestedWeights: { iq, eq, grit },
  };
}

export const isJobBand = (v: unknown): v is JobBand => (JOB_BANDS as readonly unknown[]).includes(v);
