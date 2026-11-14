/**
 * Pure helpers for the Hire workspace (hire.spec.ts): KPI wording, AI job → requisition
 * mapping, Kanban drop rules, and outreach templating/preview (mirrors the API's rules).
 */
import {
  allowedNextStages, OUTREACH_VARIABLES, type ApplicationStage, type ApplicationSummary, type CampaignDelivery,
  type GeneratedJob, type JobBand, type OutreachVariable, type PoolMember, type ReqApprovalStatus, type Requisition,
} from '@asteai/types';
import type { TagColor } from '@/components/ui';
import type { CreateRequisitionBody } from './api';

// ── KPIs ──

export const fmtDays = (d: number | null) => (d === null ? '—' : `${d % 1 === 0 ? d : d.toFixed(1)} days`);
export const fmtPct = (p: number | null) => (p === null ? '—' : `${p % 1 === 0 ? p : p.toFixed(1)}%`);

// ── Requisitions ──

export const APPROVAL_TAG: Record<ReqApprovalStatus, { label: string; color: TagColor }> = {
  draft: { label: 'Not submitted', color: 'grey' },
  pending: { label: 'Awaiting review', color: 'amber' },
  approved: { label: 'Approved', color: 'mint' },
  rejected: { label: 'Changes requested', color: 'rose' },
};

/** Where a requisition stands on the public board, in one phrase. */
export function listingState(r: Pick<Requisition, 'status' | 'posting' | 'approval'>): { label: string; color: TagColor } {
  const approval = r.approval?.status ?? 'draft';
  if (!r.posting?.isPublic) return { label: 'Private', color: 'grey' };
  if (approval !== 'approved') return APPROVAL_TAG[approval];
  if (r.status !== 'Open') return { label: `Approved · ${r.status}`, color: 'default' };
  return { label: 'Live on job board', color: 'mint' };
}

/** The ECH level (1–6) the requisition form uses, from the AI band. */
export const BAND_ECH_LEVEL: Record<JobBand, number> = {
  intern: 1, junior: 2, mid: 3, senior: 4, staff: 5, principal: 6, manager: 4, director: 6,
};

export interface PublishDetails {
  industry: string;
  func: string;
  tier: CreateRequisitionBody['tier'];
  lang: string;
  location: string;
  headcount: number;
}

/** POST /requisitions body from a reviewed AI job. */
export function jobToRequisition(job: GeneratedJob, d: PublishDetails): CreateRequisitionBody {
  const brief = [
    job.summary,
    job.responsibilities.length ? `Responsibilities:\n${job.responsibilities.map((x) => `• ${x}`).join('\n')}` : '',
    job.requirements.mustHave.length ? `Must have:\n${job.requirements.mustHave.map((x) => `• ${x}`).join('\n')}` : '',
    job.requirements.niceToHave.length ? `Nice to have:\n${job.requirements.niceToHave.map((x) => `• ${x}`).join('\n')}` : '',
  ].filter(Boolean).join('\n\n').slice(0, 10_000);
  return {
    title: job.title.slice(0, 200),
    industry: d.industry.trim(),
    func: d.func.trim(),
    echLevel: BAND_ECH_LEVEL[job.band.level],
    tier: d.tier,
    weights: job.suggestedWeights,
    lang: d.lang,
    location: d.location.trim() || undefined,
    headcount: d.headcount,
    stack: job.stack.slice(0, 50),
    brief,
    screeningQuestions: job.screeningQuestions,
    evaluationRubric: job.evaluationRubric,
  };
}

// ── Pipeline Kanban ──

/** The pipeline columns, in order (assessment stages shown as one lane before Screened). */
export const PIPELINE_COLUMNS: { stage: ApplicationStage; label: string; also?: ApplicationStage[] }[] = [
  { stage: 'Applied', label: 'Applied', also: ['Eligibility', 'Assessment Pending', 'Assessment Review'] },
  { stage: 'Screened', label: 'Screened' },
  { stage: 'Interview', label: 'Interview' },
  { stage: 'Shortlisted', label: 'Shortlist' },
  { stage: 'Offer', label: 'Offer' },
  { stage: 'Joined', label: 'Hired' },
  { stage: 'Rejected', label: 'Rejected' },
];

export function columnOf(stage: ApplicationStage): ApplicationStage {
  return PIPELINE_COLUMNS.find((c) => c.stage === stage || c.also?.includes(stage))?.stage ?? 'Applied';
}

export function groupByColumn(apps: readonly ApplicationSummary[]): Map<ApplicationStage, ApplicationSummary[]> {
  const out = new Map<ApplicationStage, ApplicationSummary[]>(PIPELINE_COLUMNS.map((c) => [c.stage, []]));
  for (const a of apps) out.get(columnOf(a.stage))?.push(a);
  return out;
}

/** Can a card at `from` be dropped on the `to` column? Same rules as the API. */
export const canDrop = (from: ApplicationStage, to: ApplicationStage, isAdmin: boolean) =>
  from !== to && allowedNextStages(from, isAdmin).includes(to);

// ── Pools ──

/**
 * Neighbours for a card dropped at `index` in a column (the list as shown, possibly
 * still containing the card being moved). Returns the ids the API's move expects.
 */
export function dropNeighbours(column: readonly Pick<PoolMember, 'id'>[], index: number, movingId: string): { beforeId?: string; afterId?: string } {
  const others = column.filter((m) => m.id !== movingId);
  const at = Math.max(0, Math.min(index, others.length));
  return { beforeId: others[at - 1]?.id, afterId: others[at]?.id };
}

const EMAIL = /[^\s<>,;"]+@[^\s<>,;"]+\.[^\s<>,;"]{2,}/;

/**
 * Pasted recipients, one per line or comma-separated: `Priya Menon <priya@x.com>`,
 * `priya@x.com, Priya Menon`, or a bare address. De-duplicated by email.
 */
export function parseRecipients(text: string): { recipients: { email: string; fullName: string }[]; invalid: string[] } {
  const seen = new Set<string>();
  const recipients: { email: string; fullName: string }[] = [];
  const invalid: string[] = [];
  for (const raw of text.split(/\r?\n|;/).map((l) => l.trim()).filter(Boolean)) {
    const m = raw.match(EMAIL);
    if (!m) { invalid.push(raw); continue; }
    const email = m[0].toLowerCase();
    const fullName = raw.replace(m[0], '').replace(/[<>,"]/g, ' ').replace(/\s+/g, ' ').trim();
    if (seen.has(email)) continue;
    seen.add(email);
    recipients.push({ email, fullName });
  }
  return { recipients, invalid };
}

// ── Outreach templates ──

const VAR = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

export function unknownVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(VAR)) if (!(OUTREACH_VARIABLES as readonly string[]).includes(m[1])) out.add(m[1]);
  return [...out];
}

export function renderPreview(template: string, vars: Partial<Record<OutreachVariable, string>>): string {
  return template.replace(VAR, (_m, name: string) => vars[name as OutreachVariable] ?? '');
}

export const VARIABLE_HELP: Record<OutreachVariable, string> = {
  firstName: 'First name', fullName: 'Full name', companyName: 'Your company', jobTitle: 'Linked job title', senderName: 'Your name',
};

/** Minutes a campaign of `n` messages takes at `rate` per minute. */
export const campaignMinutes = (n: number, rate: number) => (n <= 1 ? 0 : Math.ceil((n - 1) / Math.max(1, rate)));

export function deliveredPct(d: CampaignDelivery | null): number {
  if (!d) return 0;
  const sendable = d.total - d.skipped - d.cancelled;
  return sendable > 0 ? Math.round(((d.sent + d.failed) / sendable) * 100) : 100;
}
