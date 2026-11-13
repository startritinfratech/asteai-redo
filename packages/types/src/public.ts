// Public-site contracts (ASTEAI_REDO_SPEC §4a): marketing forms, the job board, pricing,
// digital products, help desk and sign-up one-time codes.
// Money is in the currency's minor unit (paise) where a field says `Minor`.

// ─── Marketing forms ────────────────────────────────────────────────────────────

export const LEAD_TRACKS = ['technical', 'professional', 'frontline'] as const;
export type LeadTrack = typeof LEAD_TRACKS[number];
export const WORK_MODES = ['remote', 'hybrid', 'onsite'] as const;
export type WorkMode = typeof WORK_MODES[number];
export const LEAD_TIMELINES = ['immediate', '2weeks', 'flexible'] as const;
export type LeadTimeline = typeof LEAD_TIMELINES[number];
export const LEAD_STATUSES = ['new', 'contacted', 'qualified', 'won', 'lost'] as const;
export type LeadStatus = typeof LEAD_STATUSES[number];

/** Field limits shared by the forms (web) and their DTOs (API). */
export const FORM_LIMITS = {
  name: { min: 2, max: 120 },
  email: 254,
  subject: { min: 3, max: 200 },
  message: { min: 10, max: 5000 },
  roleTitle: { min: 3, max: 120 },
  company: { min: 2, max: 160 },
  skills: 2000,
  phone: 20,
  profileUrl: 300,
  careerMessage: 3000,
} as const;

/** Common to every public form: the honeypot field and the Cloudflare Turnstile token. */
export interface BotCheck {
  /** Honeypot: must be empty. A filled value is accepted with 2xx and silently dropped. */
  website?: string;
  turnstileToken?: string;
}

export interface LeadInput extends BotCheck {
  track: LeadTrack;
  roleTitle: string;
  skills?: string;
  workMode: WorkMode;
  timeline: LeadTimeline;
  company: string;
  contactName: string;
  email: string;
  /** E.164, e.g. +919876543210. */
  phone: string;
  utm?: { source?: string; medium?: string; campaign?: string };
}

export const CONTACT_INTENTS = ['contact', 'demo'] as const;
export type ContactIntent = typeof CONTACT_INTENTS[number];

export interface ContactInput extends BotCheck {
  name: string;
  email: string;
  subject: string;
  message: string;
  intent?: ContactIntent;
}

export interface NewsletterInput extends BotCheck {
  email: string;
  source?: string;
}

/** `pending` = a confirmation email was sent (also returned for addresses already subscribed, so the response doesn't reveal who is). */
export interface NewsletterResult { status: 'pending' }

export interface CareerRole {
  id: string;
  slug: string;
  title: string;
  team: string | null;
  location: string;
  type: string;
  skills: string;
  description: string;
}

export interface CareerApplicationInput extends BotCheck {
  roleSlug: string;
  fullName: string;
  email: string;
  profileUrl?: string;
  message?: string;
}

/** What every accepted public form returns. */
export interface FormReceipt { received: true }

export interface Lead {
  id: string;
  track: LeadTrack;
  roleTitle: string;
  skills: string | null;
  workMode: WorkMode;
  timeline: LeadTimeline;
  company: string;
  contactName: string;
  email: string;
  phone: string;
  status: LeadStatus;
  createdAt: string;
}

// ─── Job board ──────────────────────────────────────────────────────────────────

export const JOB_LOCATION_TYPES = ['onsite', 'remote', 'hybrid'] as const;
export type JobLocationType = typeof JOB_LOCATION_TYPES[number];
export const EMPLOYMENT_TYPES = ['full_time', 'part_time', 'contract', 'internship'] as const;
export type EmploymentType = typeof EMPLOYMENT_TYPES[number];

export interface PublicJob {
  id: string;
  title: string;
  department: string | null;
  description: string;
  locationType: JobLocationType;
  location: string | null;
  salaryMin: number | null;
  salaryMax: number | null;
  salaryCurrency: string;
  requirements: string[];
  employmentType: EmploymentType;
  frontlineRole: string | null;
  createdAt: string;
  expiresAt: string | null;
  applicationCount: number;
  company: { name: string; logoUrl: string | null; website: string | null };
}

export interface PublicJobPage {
  items: PublicJob[];
  total: number;
  /** Opaque; pass back as `cursor` for the next page. null on the last page. */
  nextCursor: string | null;
}

// ─── Pricing & settings ────────────────────────────────────────────────────────

export const PLAN_AUDIENCES = ['individual', 'employer'] as const;
export type PlanAudience = typeof PLAN_AUDIENCES[number];

export interface Plan {
  id: string;
  audience: PlanAudience;
  name: string;
  tagline: string;
  /** null = "contact sales". */
  priceMinor: number | null;
  currency: string;
  interval: 'month' | 'year';
  monthlyCredits: number;
  features: string[];
  highlighted: boolean;
}

export interface CreditCost {
  feature: string;
  label: string;
  cost: number;
  costMax: number | null;
}

export interface PublicCreditSettings {
  welcomeBonusCredits: number;
  referralBonusCredits: number;
  maxReferralsPerUser: number;
  proposalBudgetTiers: number[];
  costs: CreditCost[];
}

export interface PublicStats {
  verifiedExperts: number;
  openJobs: number;
  openProjects: number;
  publishedServices: number;
  completedContracts: number;
}

export interface GeoInfo {
  /** ISO 3166-1 alpha-2 from the CDN's viewer-country header, or null when unknown. */
  country: string | null;
}

// ─── Digital products ──────────────────────────────────────────────────────────

export const PRODUCT_STATUSES = ['draft', 'pending', 'active', 'paused', 'rejected'] as const;
export type ProductStatus = typeof PRODUCT_STATUSES[number];
export const PRODUCT_LICENSES = ['single_team', 'organisation', 'open_source'] as const;
export type ProductLicense = typeof PRODUCT_LICENSES[number];
export const PRODUCT_LIMITS = { title: 120, summary: 300, description: 10000, tags: 10, tag: 30, maxPriceMinor: 100_000_000 } as const;

export interface ProductCard {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: string;
  tags: string[];
  priceMinor: number;
  currency: string;
  license: ProductLicense;
  sellerName: string;
  publishedAt: string | null;
}

export interface ProductDetail extends ProductCard {
  description: string;
}

export interface MyProduct extends ProductDetail {
  status: ProductStatus;
  reviewNote: string | null;
  hasFile: boolean;
  updatedAt: string;
}

export interface ProductInput {
  title: string;
  summary: string;
  description: string;
  category: string;
  tags: string[];
  priceMinor: number;
  license: ProductLicense;
}

export interface ProductPage {
  items: ProductCard[];
  total: number;
  page: number;
  pageSize: number;
}

// ─── Help desk ─────────────────────────────────────────────────────────────────

export const TICKET_STATUSES = ['open', 'pending_user', 'resolved'] as const;
export type TicketStatus = typeof TICKET_STATUSES[number];

export interface SupportCategory { id: string; name: string }

export interface SupportMessage {
  id: string;
  fromStaff: boolean;
  authorName: string;
  body: string;
  createdAt: string;
}

export interface SupportTicket {
  id: string;
  categoryId: string;
  subject: string;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
}

export interface SupportTicketDetail extends SupportTicket {
  messages: SupportMessage[];
}

export interface AdminSupportTicket extends SupportTicket {
  userId: string;
  userEmail: string;
  userName: string;
  assigneeId: string | null;
}

// ─── Sign-up one-time codes ────────────────────────────────────────────────────

export interface SendOtpResult {
  sent: true;
  /** Seconds before another code can be requested for this address. */
  resendAfter: number;
}

export interface VerifyOtpResult {
  /** Pass as `otpTicket` to POST /auth/register within `expiresIn` seconds. */
  otpTicket: string;
  expiresIn: number;
}
