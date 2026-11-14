// ─── Enterprise Hire & ATS ────────────────────────────────────────────────────
// Shared by apps/api (requisitions, applications, job-creator, talent-pools, outreach)
// and the web app.

import type { ApplicationStage } from './index';

// ── Pipeline transitions ──
// The hiring path is Applied → Screened → Interview → Shortlisted → Offer → Joined. The
// role-fit assessment can sit between Applied and Screened (Eligibility → Assessment
// Pending → Assessment Review, moved by the assessments flow). Any active stage can be
// Rejected. Joined and Rejected are final except for admins.

export const APPLICATION_STAGE_MOVES: Record<ApplicationStage, readonly ApplicationStage[]> = {
  Applied: ['Screened', 'Eligibility', 'Assessment Pending', 'Rejected'],
  Eligibility: ['Assessment Pending', 'Screened', 'Rejected'],
  'Assessment Pending': ['Assessment Review', 'Rejected'],
  'Assessment Review': ['Screened', 'Rejected'],
  Screened: ['Interview', 'Rejected'],
  Interview: ['Shortlisted', 'Rejected'],
  Shortlisted: ['Offer', 'Interview', 'Rejected'],
  Offer: ['Joined', 'Rejected'],
  Joined: [],
  Rejected: [],
};

/** Stages an employer may move an application to next (admins may move anywhere). */
export function allowedNextStages(from: ApplicationStage, isAdmin = false): readonly ApplicationStage[] {
  if (isAdmin) return (Object.keys(APPLICATION_STAGE_MOVES) as ApplicationStage[]).filter((s) => s !== from);
  return APPLICATION_STAGE_MOVES[from] ?? [];
}

export function canMoveApplication(from: ApplicationStage, to: ApplicationStage, isAdmin = false): boolean {
  return from !== to && allowedNextStages(from, isAdmin).includes(to);
}

// ── Requisition approval ──

export const REQ_APPROVAL_STATUSES = ['draft', 'pending', 'approved', 'rejected'] as const;
export type ReqApprovalStatus = (typeof REQ_APPROVAL_STATUSES)[number];

export interface ReqApproval {
  status: ReqApprovalStatus;
  note: string | null;
  submittedAt: string | null;
  reviewedAt: string | null;
}

// ── AI Job Creator ──

export const JOB_BANDS = ['intern', 'junior', 'mid', 'senior', 'staff', 'principal', 'manager', 'director'] as const;
export type JobBand = (typeof JOB_BANDS)[number];

export type ScreeningQuestionType = 'yes_no' | 'short_text' | 'multiple_choice' | 'number';

export interface ScreeningQuestion {
  question: string;
  type: ScreeningQuestionType;
  /** multiple_choice only. */
  options: string[];
  /** A wrong answer rules the candidate out (e.g. work authorisation). */
  knockout: boolean;
  /** What a good answer looks like, for the reviewer. Never shown to candidates. */
  idealAnswer: string;
}

export interface JobRubricCriterion {
  criterion: string;
  /** Whole percent; a rubric's weights sum to 100. */
  weight: number;
  strongSignals: string[];
  weakSignals: string[];
}

/** POST /ai/jobs/generate */
export interface GeneratedJob {
  title: string;
  summary: string;
  band: { level: JobBand; label: string; yearsMin: number; yearsMax: number | null };
  responsibilities: string[];
  requirements: { mustHave: string[]; niceToHave: string[] };
  stack: string[];
  screeningQuestions: ScreeningQuestion[];
  evaluationRubric: JobRubricCriterion[];
  /** Matches a requisition's weights (whole numbers summing to 100). */
  suggestedWeights: { iq: number; eq: number; grit: number };
}

export interface GeneratedJobResponse {
  job: GeneratedJob;
  credits: { charged: number; balance: number };
}

// ── Talent CRM pools ──

export interface PoolColumn { key: string; label: string }

export interface TalentPoolSummary {
  id: string;
  name: string;
  description: string;
  columns: PoolColumn[];
  memberCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PoolMember {
  id: string;
  userId: string | null;
  email: string;
  fullName: string;
  column: string;
  position: number;
  tags: string[];
  notes: string;
  updatedAt: string;
}

export interface PoolBoard {
  pool: TalentPoolSummary;
  columns: (PoolColumn & { members: PoolMember[] })[];
}

// ── Outreach ──

export type CampaignStatus = 'draft' | 'queued' | 'completed' | 'cancelled';
export type MessageDelivery = 'queued' | 'sending' | 'sent' | 'failed' | 'skipped' | 'cancelled';

/** Variables a template may use, as {{name}}. */
export const OUTREACH_VARIABLES = ['firstName', 'fullName', 'companyName', 'jobTitle', 'senderName'] as const;
export type OutreachVariable = (typeof OUTREACH_VARIABLES)[number];

export interface OutreachRecipient { email: string; fullName: string }

export interface CampaignDelivery {
  total: number;
  queued: number;
  sending: number;
  sent: number;
  failed: number;
  skipped: number;
  cancelled: number;
}

export interface OutreachEmailCampaign {
  id: string;
  name: string;
  subjectTemplate: string;
  bodyTemplate: string;
  requisitionId: string | null;
  poolId: string | null;
  status: CampaignStatus;
  ratePerMinute: number;
  recipientCount: number;
  delivery: CampaignDelivery | null;
  queuedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

// ── Hiring KPIs ──

/** GET /analytics/employer/hiring-kpis (an admin without a company sees the whole platform). */
export interface HiringKpis {
  openRequisitions: number;
  pendingApproval: number;
  /** Outreach campaigns currently sending. */
  activeCampaigns: number;
  /** Median days from application to Joined, over hires in the last 180 days; null with no hires. */
  timeToHireDays: number | null;
  hiresLast180Days: number;
  /**
   * Of applications reviewed in the last 90 days (past the initial Applied/assessment
   * stages, or rejected), the percentage that advanced to Screened or beyond. Null when
   * nothing was reviewed.
   */
  matchRatePct: number | null;
  reviewedLast90Days: number;
  /** Current applications per stage. */
  byStage: Partial<Record<import('./index').ApplicationStage, number>>;
}
