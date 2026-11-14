/**
 * Pure helpers for the Career Studio UI (format.spec.ts). Nothing here re-scores
 * anything; scores come from the API.
 */
import {
  RESUME_MAX_BYTES, RESUME_MIME_TYPES, type ApplicationStage, type ApplicationSummary, type CompetencyView,
  type PassportProfile, type StudioRecommendation, type TestStatus, type VerificationResult,
} from '@asteai/types';
import type { TagColor } from '@/components/ui';

// ── Applications ──

/** The hiring path in order (see APPLICATION_STAGE_MOVES in @asteai/types). */
const STAGE_ORDER: ApplicationStage[] = [
  'Applied', 'Eligibility', 'Assessment Pending', 'Assessment Review', 'Screened', 'Interview', 'Shortlisted', 'Offer', 'Joined',
];

/** 0–1 progress through the hiring funnel (a rejection keeps the stage it reached). */
export function stageProgress(app: Pick<ApplicationSummary, 'stage' | 'history'>): number {
  let stage = app.stage;
  if (stage === 'Rejected') {
    const reached = [...(app.history ?? [])].reverse().find((h) => h.stage !== 'Rejected');
    stage = reached?.stage ?? 'Applied';
  }
  const i = STAGE_ORDER.indexOf(stage);
  return i < 0 ? 0 : i / (STAGE_ORDER.length - 1);
}

export function stageColor(stage: ApplicationStage): TagColor {
  if (stage === 'Rejected') return 'rose';
  if (stage === 'Offer' || stage === 'Joined') return 'mint';
  if (stage === 'Assessment Pending') return 'amber';
  if (stage === 'Shortlisted' || stage === 'Interview') return 'gold';
  return 'default';
}

/** Applications still waiting on the candidate's assessment (same rule as /platform/assess). */
export function pendingAssessments(apps: readonly ApplicationSummary[]): ApplicationSummary[] {
  return apps.filter((a) => !a.resultId && a.stage !== 'Rejected');
}

export interface TimelineEvent { applicationId: string; title: string; stage: ApplicationStage; t: number }

/** Every stage change across applications, newest first. */
export function applicationTimeline(apps: readonly ApplicationSummary[], limit = 12): TimelineEvent[] {
  const events: TimelineEvent[] = [];
  for (const a of apps) {
    const title = a.requisitionTitle ?? 'Application';
    const history = a.history?.length ? a.history : [{ t: a.t, stage: a.stage, by: '' }];
    for (const h of history) events.push({ applicationId: a.id, title, stage: h.stage, t: h.t });
  }
  return events.sort((x, y) => y.t - x.t).slice(0, limit);
}

// ── Passport ──

export type PassportStatus = 'empty' | 'private' | 'public';

export function passportStatus(p: PassportProfile | undefined): PassportStatus {
  if (!p || !p.competencies.length) return 'empty';
  return p.visibility;
}

export function percentileLabel(p: number | null): string {
  if (p === null) return 'Not ranked yet';
  if (p >= 50) return `Top ${Math.max(1, Math.round(100 - p))}%`;
  return `${Math.round(p)}th percentile`;
}

/** Bar width in percent, never fully empty so a score of 0 still reads as a bar. */
export const barWidth = (score: number) => `${Math.max(2, Math.min(100, score))}%`;

export function scoreBand(score: number): { label: string; color: TagColor } {
  if (score >= 80) return { label: 'Expert', color: 'mint' };
  if (score >= 60) return { label: 'Proficient', color: 'gold' };
  if (score >= 40) return { label: 'Developing', color: 'amber' };
  return { label: 'Emerging', color: 'grey' };
}

/** Competencies grouped for display, strongest first within each group. */
export function groupCompetencies(list: readonly CompetencyView[]): [string, CompetencyView[]][] {
  const label = { tech: 'Technical', trades: 'Trades & safety', core: 'Core skills' } as const;
  const groups = new Map<string, CompetencyView[]>();
  for (const c of list) groups.set(label[c.category], [...(groups.get(label[c.category]) ?? []), c]);
  return [...groups].map(([k, v]) => [k, [...v].sort((a, b) => b.score - a.score)]);
}

export function verificationMessage(v: VerificationResult): string {
  if (v.valid) return 'Signature verified';
  return {
    not_found: 'No credential with this code',
    revoked: 'Revoked by its holder',
    expired: 'This credential has expired',
    bad_signature: 'Signature does not match: do not trust this credential',
    unavailable: 'Verification is unavailable right now',
  }[v.reason];
}

// ── Interviews ──

export const RECOMMENDATION_LABEL: Record<StudioRecommendation, { label: string; color: TagColor }> = {
  strong: { label: 'Strong', color: 'mint' },
  ready: { label: 'Ready', color: 'gold' },
  developing: { label: 'Developing', color: 'amber' },
  not_ready: { label: 'Not ready yet', color: 'rose' },
};

/** BCP 47 tags for speech recognition / synthesis (India first for the Indian languages). */
const SPEECH_LOCALE: Record<string, string> = {
  en: 'en-IN', hi: 'hi-IN', te: 'te-IN', ta: 'ta-IN', kn: 'kn-IN', bn: 'bn-IN',
  fr: 'fr-FR', es: 'es-ES', de: 'de-DE', ar: 'ar-SA', pt: 'pt-BR', zh: 'zh-CN', ja: 'ja-JP', ko: 'ko-KR',
};
export const speechLocale = (code: string) => SPEECH_LOCALE[code] ?? code;

// ── Challenges ──

export const TEST_STATUS_LABEL: Record<TestStatus, string> = {
  ok: 'Passed', wrong_answer: 'Wrong answer', compile_error: 'Compile error', runtime_error: 'Runtime error',
  time_limit: 'Time limit', internal_error: 'Runner error', skipped: 'Skipped',
};

// ── Résumé ──

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Checks a chosen file before asking for an upload URL. Browsers sometimes report a
 * DOCX with an empty type, so the extension decides when the type is missing.
 */
export function checkResumeFile(file: { name: string; type: string; size: number }): { contentType: string } | { error: string } {
  const ext = file.name.toLowerCase().split('.').pop() ?? '';
  const byExt = ext === 'pdf' ? RESUME_MIME_TYPES.pdf : ext === 'docx' ? RESUME_MIME_TYPES.docx : null;
  if (!byExt) return { error: 'Choose a PDF or Word (.docx) file.' };
  if (file.type && file.type !== byExt) return { error: `That file says it is ${file.type}, not a ${ext.toUpperCase()}.` };
  if (file.size === 0) return { error: 'That file is empty.' };
  if (file.size > RESUME_MAX_BYTES) return { error: `That file is ${formatBytes(file.size)}; the limit is 5 MB.` };
  return { contentType: byExt };
}

// ── Autofill → profile ──

export const PROFILE_FIELDS = [
  ['headline', 'Headline'], ['summary', 'Summary'], ['skills', 'Skills'], ['domains', 'Fields'],
  ['languages', 'Languages'], ['yearsExperience', 'Years of experience'], ['location', 'Location'], ['links', 'Links'],
] as const;
export type ProfileField = (typeof PROFILE_FIELDS)[number][0];

/** PUT /profiles/me body from the reviewed draft: only the ticked fields that have a value. */
export function draftToProfilePatch(draft: import('@asteai/types').ResumeDraft, fields: ReadonlySet<ProfileField>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  const has = (v: unknown) => (Array.isArray(v) ? v.length > 0 : v !== '' && v !== null && v !== undefined);
  for (const f of fields) {
    if (f === 'links') {
      for (const [k, v] of Object.entries(draft.links)) if (has(v)) out[k] = v;
    } else if (has(draft[f])) {
      out[f] = draft[f];
    }
  }
  return out;
}

/**
 * Whether a verified credential is this passport's: one of its listed codes, or a
 * passport snapshot whose signed claims name this passport. Stops a visitor from showing
 * someone else's valid credential on this page via ?credential=.
 */
export function credentialBelongs(
  result: VerificationResult, slug: string, knownCodes: readonly string[],
): boolean {
  if (!result.valid) return false;
  if (knownCodes.includes(result.code)) return true;
  const subject = result.claims.subject as { passportSlug?: unknown } | undefined;
  return result.kind === 'passport_snapshot' && subject?.passportSlug === slug;
}
