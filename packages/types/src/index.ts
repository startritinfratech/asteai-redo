// @asteai/types
// All string unions are exported as const arrays so bun 1.x can resolve them
// at runtime. TypeScript consumers still get full type safety via typeof.

// ─── User & Auth ─────────────────────────────────────────────────────────────

export const USER_ROLES = ['Employer', 'Candidate', 'Freelancer', 'Buyer', 'Admin'] as const;
export type UserRole = typeof USER_ROLES[number];

export const ACCOUNT_STATUSES = ['active', 'deactivated', 'deleted'] as const;
export type AccountStatus = typeof ACCOUNT_STATUSES[number];

export interface User {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  tenantId: string | null;
  title?: string;
  avatarUrl?: string;
  lang?: string;
  accountStatus: AccountStatus;
  emailVerified: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Tenant {
  id: string;
  name: string;
  industry: string;
  plan: 'Free' | 'Growth' | 'Enterprise' | 'Marketplace' | '-';
  credits: number;
  seats: number;
  domain: string;
  retentionMonths: number;
  ssoEnabled: boolean;
}

// ─── Requisitions & ATS ──────────────────────────────────────────────────────

export const REQ_STATUSES = ['Draft', 'Open', 'Paused', 'Closed', 'Filled'] as const;
export type ReqStatus = typeof REQ_STATUSES[number];

export const CANDIDATE_TIERS = ['Technical', 'Non-Technical', 'Frontline', 'Skilled'] as const;
export type CandidateTier = typeof CANDIDATE_TIERS[number];

export interface WeightConfig {
  iq: number;
  eq: number;
  grit: number;
}

/** SLA timestamps are ISO strings (null until the event happens). */
export interface SlaConfig {
  funded: boolean;
  start: string | null;
  paused: string | null;
  delivered: string | null;
}

/** A requisition as returned by GET /requisitions. */
export interface Requisition {
  id: string;
  tenantId: string;
  ownerId: string;
  ownerName?: string;
  title: string;
  industry: string;
  func: string;
  echLevel: number;
  tier: CandidateTier;
  weights: WeightConfig;
  lang: string;
  location: string | null;
  headcount: number;
  minShortlist: number;
  /** NUMERIC column: Postgres returns it as a string. */
  threshold: number | string;
  status: ReqStatus;
  sla: SlaConfig;
  stack: string[];
  brief: string | null;
  createdAt: string;
  updatedAt: string;
}

export const APPLICATION_STAGES = [
  'Applied', 'Eligibility', 'Assessment Pending', 'Assessment Review',
  'Shortlisted', 'Interview', 'Offer', 'Joined', 'Rejected',
] as const;
export type ApplicationStage = typeof APPLICATION_STAGES[number];

export interface HistoryEntry {
  t: number;
  stage: ApplicationStage;
  by: string;
}

export interface InterviewInfo {
  t: number;
  panel: string;
  kit: string;
}

export interface OfferInfo {
  t: number;
  status: 'Sent' | 'Accepted' | 'Declined';
  ctc: string;
}

export interface Application {
  id: string;
  candidateId: string;
  requisitionId: string;
  tenantId: string;
  stage: ApplicationStage;
  t: number;
  resultId: string | null;
  notes: string[];
  scorecards: Scorecard[];
  interview: InterviewInfo | null;
  offer: OfferInfo | null;
  history: HistoryEntry[];
}

/** An application as listed by the API, with the joined requisition / candidate details. */
export interface ApplicationSummary extends Application {
  requisitionTitle?: string;
  industry?: string;
  tier?: CandidateTier;
  candidateName?: string;
  candidateEmail?: string;
}

export interface Scorecard {
  id: string;
  by: string;
  score: number;
  note: string;
  t: number;
}

// ─── Assessment ───────────────────────────────────────────────────────────────

export interface StenScores {
  iq: number;
  eq: number;
  grit: number;
}

export interface ThetaScores {
  iq: number;
  eq: number;
  grit: number;
}

export interface AssessmentResult {
  id: string;
  candidateId: string;
  requisitionId: string;
  theta: ThetaScores;
  sten: StenScores;
  fitScore: number;
  ci: number;
  integrity: 'Clear' | 'Review';
  integ: { blur: number; paste: number; fast: number };
  n: { iq: number; eq: number; grit: number };
  durationSeconds: number;
  date: number;
  ev: unknown;
  self: unknown;
  safety: unknown;
  sealed: boolean;
  hash: string;
}

// ─── Talent Passport ─────────────────────────────────────────────────────────

export const PASSPORT_STATUSES = ['Valid', 'Expired', 'Revoked'] as const;
export type PassportStatus = typeof PASSPORT_STATUSES[number];

export interface Passport {
  id: string;
  userId: string;
  name: string;
  tier: CandidateTier;
  scores: Array<[string, number]>;
  sten: StenScores;
  percentile: number;
  hash: string;
  issuedAt: number;
  validUntil: number;
  status: PassportStatus;
  share: { discoverable: boolean; showIdentity: boolean };
  verifications: Array<{ t: number; by: string }>;
}

// ─── Projects & Marketplace ──────────────────────────────────────────────────

export const PROJECT_STAGES = [
  'Open for Bids', 'Shortlisting', 'Contracted',
  'In Progress', 'Milestone Submitted', 'Completed', 'Disputed',
] as const;
export type ProjectStage = typeof PROJECT_STAGES[number];

export const MILESTONE_STATUSES = [
  'Pending', 'Funded', 'Submitted', 'Accepted',
  'Released', 'Disputed', 'Revision requested',
] as const;
export type MilestoneStatus = typeof MILESTONE_STATUSES[number];

export interface Milestone {
  id: string;
  name: string;
  amount: number;
  status: MilestoneStatus;
  dueDate: number;
}

/**
 * Pending → Awarded | Rejected when the buyer awards a bid. Once a contract for the awarded
 * bid is declined by the expert ('Declined') or cancelled before any money moved
 * ('Withdrawn'), the project reopens and the bids the award rejected are 'Pending' again.
 */
export const PROPOSAL_STATUSES = ['Pending', 'Awarded', 'Rejected', 'Declined', 'Withdrawn'] as const;
export type ProposalStatus = typeof PROPOSAL_STATUSES[number];

/** A bid on a project, as returned by the /proposals endpoints. */
export interface Proposal {
  id: string;
  projectId: string;
  expertId: string;
  price: number;
  days: number;
  note: string;
  status: ProposalStatus;
  createdAt: string; // ISO
  updatedAt: string; // ISO
  /** GET /proposals/project/:id (the buyer's view). */
  expertName?: string;
  /** GET /proposals/mine (the expert's view). */
  projectTitle?: string;
  projectStage?: ProjectStage;
  /** The contract for this proposal, once the buyer created one; undefined when not selected. */
  contractId?: string | null;
}

export interface Project {
  id: string;
  buyerId: string;
  /** null for a buyer's own project (not owned by a tenant). */
  tenantId: string | null;
  title: string;
  domain: string;
  budget: number;
  stage: ProjectStage;
  description: string;
  milestones: Milestone[];
  ndaRequired: boolean;
  createdAt: number;
  awardedTo: string | null;
  proposals: Proposal[];
  rating: { buyer: number; freelancer: number } | null;
  packaged?: boolean;
}

// ─── Ledger ───────────────────────────────────────────────────────────────────

export const LEDGER_TYPES = [
  'Subscription', 'Credits', 'Escrow hold',
  'Escrow release', 'Payout', 'Fee', 'Refund',
] as const;
export type LedgerType = typeof LEDGER_TYPES[number];

export interface LedgerEntry {
  id: string;
  t: number;
  tenantId: string;
  type: LedgerType;
  description: string;
  amount: number;
  unit?: string;
  payee?: string;
  fee?: number;
  by: string;
  ref: string;
}

/** GET /ledger/wallet: a user's wallet totals (in INR). */
/** GET /ledger/wallet (kept for older callers; see WalletBalances in ./billing). */
export type { WalletBalances as WalletSummary } from './billing';

// ─── Dashboards ─────────────────────────────────────────────────────────────

/** GET /admin/stats. Postgres COUNT(*) values arrive as strings. */
export interface AdminStats {
  totalTenants: number;
  usersByRole: Array<{ role: UserRole; count: string }>;
  reqs: Array<{ status: ReqStatus; count: string }>;
  applications: Array<{ stage: ApplicationStage; count: string }>;
  passports: Array<{ status: PassportStatus; count: string }>;
}

// ─── Notifications ───────────────────────────────────────────────────────────

export interface Notification {
  id: string;
  userId: string;
  t: number;
  text: string;
  link: string;
  read: boolean;
}

// ─── Audit ────────────────────────────────────────────────────────────────────

export interface AuditEntry {
  t: number;
  actor: string;
  role: UserRole;
  action: string;
  entity: string;
  meta: string;
}

// ─── Talent Pools & Outreach ─────────────────────────────────────────────────

export interface TalentPool {
  id: string;
  tenantId: string;
  name: string;
  count: number;
  consentExpiry: number;
  tags: string[];
}

export interface OutreachCampaign {
  id: string;
  tenantId: string;
  name: string;
  channel: 'WhatsApp' | 'Email' | 'SMS';
  sent: number;
  opened: number;
  applied: number;
  status: 'Running' | 'Done' | 'Draft';
  t: number;
}

// ─── API Response wrappers ───────────────────────────────────────────────────

export interface ApiResponse<T> {
  data: T;
  meta?: Record<string, unknown>;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ApiError {
  statusCode: number;
  message: string;
  errors?: Record<string, string[]>;
}

// ── Voice assistant ───────────────────────────────────────────────────────────

/**
 * What a voice command can do. The browser executes it; the model only picks one
 * of the targets the browser offered.
 */
export const VOICE_ACTION_KINDS = ['navigate', 'invoke', 'fill', 'scroll', 'back', 'answer', 'clarify'] as const;
export type VoiceActionKind = typeof VOICE_ACTION_KINDS[number];

export const VOICE_TARGET_KINDS = ['route', 'action', 'field'] as const;
export type VoiceTargetKind = typeof VOICE_TARGET_KINDS[number];

/** Something on the current screen (or a page the user may open) that voice can reach. */
export interface VoiceTarget {
  /** Stable id, e.g. `route:requisitions` or `action:requisitions.create`. */
  id: string;
  kind: VoiceTargetKind;
  /** What the user sees / would say: "New Requisition". */
  label: string;
  description?: string;
  /** Changes data (submit, award, pay…): the user must confirm before it runs. */
  confirm?: boolean;
}

export interface VoiceCommandRequest {
  utterance: string;
  pathname: string;
  /** BCP-47 language of the utterance; the spoken reply uses it too. */
  language?: string;
  targets: VoiceTarget[];
}

export interface VoiceCommandResult {
  kind: VoiceActionKind;
  /** Id of one of the request's targets, or null for scroll / back / answer / clarify. */
  targetId: string | null;
  /** Text for `fill`, `up` / `down` for `scroll`. */
  value: string | null;
  /** Short reply to speak back. */
  speech: string;
  needsConfirmation: boolean;
}

// ── Role-fit assessment ───────────────────────────────────────────────────────

/**
 * One screen of the role-fit battery, as deeptech_ai describes it. `type` says how to
 * draw it; the remaining fields depend on the type (see deeptech_ai psychometric/engine.py).
 * Items never contain answers or scores.
 */
export interface AssessmentItem {
  id: string;
  type: string;
  progress: { index: number; total: number };
  [field: string]: unknown;
}

export interface AssessmentStep {
  sessionId: string;
  done: boolean;
  /** The next screen, while `done` is false. */
  item?: AssessmentItem;
  /** The stored result once `done` is true. Scores are not sent to the candidate. */
  resultId?: string;
}

export const ASSESSMENT_SESSION_STATUSES = ['active', 'completed', 'expired', 'reset'] as const;
export type AssessmentSessionStatus = typeof ASSESSMENT_SESSION_STATUSES[number];

/** An assessment session as admins see it (Master Control → Assessment Sessions). */
export interface AssessmentSessionAdmin {
  id: string;
  status: AssessmentSessionStatus;
  candidateId: string;
  candidateName: string;
  candidateEmail: string;
  requisitionId: string;
  requisitionTitle: string;
  tenantId: string;
  startedAt: string;
  completedAt: string | null;
  resultId: string | null;
  resetAt: string | null;
  resetReason: string | null;
  resetByName: string | null;
}

export * from './chat';
export * from './contract';
export * from './profile';
export * from './account';
export * from './payment';
export * from './billing';
export * from './dispute';
export * from './gig';
