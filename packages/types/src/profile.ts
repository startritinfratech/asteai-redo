// ─── Profiles, expert directory and reviews ──────────────────────────────────
// Shared by apps/api (modules/profiles) and apps/web (features/profiles).
// Type-only, plus the const arrays and limits the API validates against.

export const EXPERT_PROFILE_STATUSES = ['draft', 'pending', 'approved', 'rejected', 'rework'] as const;
export type ExpertProfileStatus = typeof EXPERT_PROFILE_STATUSES[number];

/** Decisions an admin can take on a submitted profile. */
export const EXPERT_REVIEW_DECISIONS = ['approved', 'rejected', 'rework'] as const;
export type ExpertReviewDecision = typeof EXPERT_REVIEW_DECISIONS[number];

export const ENGAGEMENT_MODES = ['hourly', 'daily', 'fixed', 'sprint'] as const;
export type EngagementMode = typeof ENGAGEMENT_MODES[number];

export const AVAILABILITIES = ['available', 'limited', 'unavailable'] as const;
export type Availability = typeof AVAILABILITIES[number];

export const EXPERT_SORTS = ['relevance', 'rating', 'rate'] as const;
export type ExpertSort = typeof EXPERT_SORTS[number];

export const PROFILE_LIMITS = {
  headline: 140,
  summary: 4000,
  /** Max entries in skills / domains / languages. */
  skills: 30,
  domains: 10,
  languages: 10,
  /** Max length of one skill / domain / language entry. */
  tag: 40,
  yearsExperience: 60,
  /** Upper bound for hourly / daily / fixed-from rates (any currency). */
  rate: 10_000_000,
  url: 300,
  location: 120,
  reviewComment: 2000,
  adminNote: 2000,
  company: 160,
  about: 4000,
} as const;

/** A freelancer's own expert profile, as GET/PUT /profiles/me return it. */
export interface ExpertProfile {
  kind: 'expert';
  userId: string;
  headline: string;
  summary: string;
  domains: string[];
  skills: string[];
  languages: string[];
  yearsExperience: number | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  fixedFrom: number | null;
  currency: string;
  engagementModes: EngagementMode[];
  availability: Availability;
  location: string;
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  status: ExpertProfileStatus;
  adminNote: string | null;
  reviewedAt: string | null;
  rating: number;
  reviewCount: number;
  /** 0–100, recomputed on every save. */
  completion: number;
  createdAt: string | null;
  updatedAt: string | null;
}

export interface BuyerProfile {
  kind: 'buyer';
  userId: string;
  companyName: string;
  industry: string;
  website: string;
  country: string;
  about: string;
  completion: number;
}

export type MyProfile = ExpertProfile | BuyerProfile;

/** Body of PUT /profiles/me for a Freelancer. Every field optional (partial update). */
export interface ExpertProfileInput {
  headline?: string;
  summary?: string;
  domains?: string[];
  skills?: string[];
  languages?: string[];
  yearsExperience?: number | null;
  hourlyRate?: number | null;
  dailyRate?: number | null;
  fixedFrom?: number | null;
  currency?: string;
  engagementModes?: EngagementMode[];
  availability?: Availability;
  location?: string;
  portfolioUrl?: string;
  linkedinUrl?: string;
  githubUrl?: string;
}

/** Body of PUT /profiles/me for a Buyer. */
export interface BuyerProfileInput {
  companyName?: string;
  industry?: string;
  website?: string;
  country?: string;
  about?: string;
}

/** The passport badge shown on a public card: only a Valid, discoverable passport. */
export interface ExpertPassportBadge {
  id: string;
  tier: string;
}

/** One card of the public directory (GET /experts). Never carries an email. */
export interface ExpertCard {
  userId: string;
  /** First name + last initial, e.g. "Asha K." */
  name: string;
  avatarUrl: string | null;
  headline: string;
  skills: string[];
  domains: string[];
  hourlyRate: number | null;
  dailyRate: number | null;
  fixedFrom: number | null;
  currency: string;
  engagementModes: EngagementMode[];
  availability: Availability;
  location: string;
  yearsExperience: number | null;
  rating: number;
  reviewCount: number;
  passport: ExpertPassportBadge | null;
}

export interface ExpertPage {
  items: ExpertCard[];
  total: number;
  page: number;
  pageSize: number;
}

export interface ExpertReview {
  id: string;
  rating: number;
  comment: string;
  /** First name + last initial of the reviewer. */
  reviewerName: string;
  projectId: string | null;
  projectTitle: string | null;
  createdAt: string;
}

/** GET /experts/:userId. `status` is 'approved' unless the owner or an admin is looking. */
export interface ExpertDetail extends ExpertCard {
  summary: string;
  languages: string[];
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  status: ExpertProfileStatus;
  reviews: ExpertReview[];
  memberSince: string;
}

/** A row of the admin approval queue (GET /admin/experts). */
export interface ExpertApprovalItem {
  userId: string;
  fullName: string;
  email: string;
  headline: string;
  summary: string;
  skills: string[];
  domains: string[];
  yearsExperience: number | null;
  hourlyRate: number | null;
  dailyRate: number | null;
  currency: string;
  portfolioUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  completion: number;
  status: ExpertProfileStatus;
  adminNote: string | null;
  reviewedAt: string | null;
  updatedAt: string;
}

export interface CreateReviewInput {
  revieweeId: string;
  projectId: string;
  rating: number;
  comment?: string;
}
