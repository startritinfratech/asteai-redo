import type {
  Availability, BuyerProfile, EngagementMode, ExpertApprovalItem, ExpertCard, ExpertDetail, ExpertProfile,
  ExpertProfileStatus, ExpertReview,
} from './profile.types';

// pg returns NUMERIC as strings and TIMESTAMPTZ as Date.
const numOrNull = (v: string | number | null | undefined) => (v === null || v === undefined ? null : Number(v));
const iso = (v: Date | string | null | undefined) => (v ? new Date(v).toISOString() : null);

/** "Asha Kumar" → "Asha K." — the only form of a name the public directory shows. */
export function publicName(first: string | null | undefined, last: string | null | undefined): string {
  const f = (first ?? '').trim();
  const initial = (last ?? '').trim().charAt(0).toUpperCase();
  if (!f) return initial ? `${initial}.` : 'Expert';
  return initial ? `${f} ${initial}.` : f;
}

export interface ExpertProfileRow {
  user_id: string;
  headline: string | null;
  summary: string | null;
  domains: string[] | null;
  skills: string[] | null;
  languages: string[] | null;
  years_experience: number | null;
  hourly_rate: string | number | null;
  daily_rate: string | number | null;
  fixed_from: string | number | null;
  currency: string | null;
  engagement_modes: string[] | null;
  availability: string | null;
  location: string | null;
  portfolio_url: string | null;
  linkedin_url: string | null;
  github_url: string | null;
  status: ExpertProfileStatus;
  admin_note: string | null;
  reviewed_at: Date | string | null;
  rating: string | number | null;
  review_count: number | null;
  completion: number | null;
  created_at: Date | string | null;
  updated_at: Date | string | null;
}

/** Profile columns, without `search` (a tsvector nobody needs on the wire). */
export const EXPERT_COLUMNS = `p.user_id, p.headline, p.summary, p.domains, p.skills, p.languages, p.years_experience,
  p.hourly_rate, p.daily_rate, p.fixed_from, p.currency, p.engagement_modes, p.availability, p.location,
  p.portfolio_url, p.linkedin_url, p.github_url, p.status, p.admin_note, p.reviewed_at, p.rating,
  p.review_count, p.completion, p.created_at, p.updated_at`;

export function emptyExpertProfile(userId: string): ExpertProfile {
  return {
    kind: 'expert', userId, headline: '', summary: '', domains: [], skills: [], languages: [],
    yearsExperience: null, hourlyRate: null, dailyRate: null, fixedFrom: null, currency: 'INR',
    engagementModes: [], availability: 'available', location: '', portfolioUrl: '', linkedinUrl: '',
    githubUrl: '', status: 'draft', adminNote: null, reviewedAt: null, rating: 0, reviewCount: 0,
    completion: 0, createdAt: null, updatedAt: null,
  };
}

export function mapExpertProfile(r: ExpertProfileRow): ExpertProfile {
  return {
    kind: 'expert',
    userId: r.user_id,
    headline: r.headline ?? '',
    summary: r.summary ?? '',
    domains: r.domains ?? [],
    skills: r.skills ?? [],
    languages: r.languages ?? [],
    yearsExperience: r.years_experience,
    hourlyRate: numOrNull(r.hourly_rate),
    dailyRate: numOrNull(r.daily_rate),
    fixedFrom: numOrNull(r.fixed_from),
    currency: (r.currency ?? 'INR').trim(),
    engagementModes: (r.engagement_modes ?? []) as EngagementMode[],
    availability: (r.availability ?? 'available') as Availability,
    location: r.location ?? '',
    portfolioUrl: r.portfolio_url ?? '',
    linkedinUrl: r.linkedin_url ?? '',
    githubUrl: r.github_url ?? '',
    status: r.status,
    adminNote: r.admin_note,
    reviewedAt: iso(r.reviewed_at),
    rating: Number(r.rating ?? 0),
    reviewCount: r.review_count ?? 0,
    completion: r.completion ?? 0,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

export interface BuyerProfileRow {
  user_id: string;
  company_name: string | null;
  industry: string | null;
  website: string | null;
  country: string | null;
  about: string | null;
  completion: number | null;
}

export function mapBuyerProfile(r: BuyerProfileRow): BuyerProfile {
  return {
    kind: 'buyer',
    userId: r.user_id,
    companyName: r.company_name ?? '',
    industry: r.industry ?? '',
    website: r.website ?? '',
    country: r.country ?? '',
    about: r.about ?? '',
    completion: r.completion ?? 0,
  };
}

export function emptyBuyerProfile(userId: string): BuyerProfile {
  return { kind: 'buyer', userId, companyName: '', industry: '', website: '', country: '', about: '', completion: 0 };
}

/**
 * How complete an expert profile is, 0–100. Weights favour what buyers filter and
 * read on: headline, summary, skills, rates and a link to past work.
 */
export function expertCompletion(p: Omit<ExpertProfile, 'kind'>): number {
  const parts: Array<[boolean, number]> = [
    [p.headline.trim().length >= 10, 15],
    [p.summary.trim().length >= 80, 15],
    [p.skills.length >= 3, 15],
    [p.domains.length >= 1, 10],
    [p.languages.length >= 1, 5],
    [p.yearsExperience !== null, 5],
    [p.hourlyRate !== null || p.dailyRate !== null || p.fixedFrom !== null, 10],
    [p.engagementModes.length >= 1, 5],
    [p.location.trim() !== '', 5],
    [Boolean(p.portfolioUrl || p.linkedinUrl || p.githubUrl), 15],
  ];
  return parts.reduce((sum, [ok, w]) => sum + (ok ? w : 0), 0);
}

export function buyerCompletion(p: Omit<BuyerProfile, 'kind'>): number {
  const parts: Array<[string, number]> = [
    [p.companyName, 30], [p.industry, 20], [p.website, 15], [p.country, 15], [p.about, 20],
  ];
  return parts.reduce((sum, [v, w]) => sum + (v.trim() ? w : 0), 0);
}

/** What still blocks "Submit for review"; empty when the profile can be submitted. */
export function missingForSubmit(p: ExpertProfile): string[] {
  const missing: string[] = [];
  if (p.headline.trim().length < 10) missing.push('a headline (10+ characters)');
  if (p.summary.trim().length < 80) missing.push('a summary (80+ characters)');
  if (p.skills.length < 3) missing.push('at least 3 skills');
  if (!p.domains.length) missing.push('at least one domain');
  if (!p.engagementModes.length) missing.push('an engagement mode');
  if (p.hourlyRate === null && p.dailyRate === null && p.fixedFrom === null) missing.push('a rate');
  return missing;
}

/** A directory row: profile columns plus the joined user and passport columns. */
export interface ExpertCardRow extends ExpertProfileRow {
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  passport_id: string | null;
  passport_tier: string | null;
  member_since?: Date | string | null;
}

/**
 * Builds the public card field by field. Nothing is spread from the row, so a column
 * added to the query (an email, an admin note) can never leak into the response.
 */
export function mapExpertCard(r: ExpertCardRow): ExpertCard {
  const p = mapExpertProfile(r);
  return {
    userId: p.userId,
    name: publicName(r.first_name, r.last_name),
    avatarUrl: r.avatar_url ?? null,
    headline: p.headline,
    skills: p.skills,
    domains: p.domains,
    hourlyRate: p.hourlyRate,
    dailyRate: p.dailyRate,
    fixedFrom: p.fixedFrom,
    currency: p.currency,
    engagementModes: p.engagementModes,
    availability: p.availability,
    location: p.location,
    yearsExperience: p.yearsExperience,
    rating: p.rating,
    reviewCount: p.reviewCount,
    passport: r.passport_id ? { id: r.passport_id, tier: r.passport_tier ?? '' } : null,
  };
}

export function mapExpertDetail(r: ExpertCardRow, reviews: ExpertReview[]): ExpertDetail {
  const p = mapExpertProfile(r);
  return {
    ...mapExpertCard(r),
    summary: p.summary,
    languages: p.languages,
    portfolioUrl: p.portfolioUrl,
    linkedinUrl: p.linkedinUrl,
    githubUrl: p.githubUrl,
    status: p.status,
    reviews,
    memberSince: iso(r.member_since ?? r.created_at) ?? '',
  };
}

export interface ReviewRow {
  id: string;
  rating: number;
  comment: string | null;
  reviewer_first_name: string | null;
  reviewer_last_name: string | null;
  project_id: string | null;
  project_title: string | null;
  created_at: Date | string;
}

export function mapReview(r: ReviewRow): ExpertReview {
  return {
    id: r.id,
    rating: r.rating,
    comment: r.comment ?? '',
    reviewerName: publicName(r.reviewer_first_name, r.reviewer_last_name),
    projectId: r.project_id,
    projectTitle: r.project_title,
    createdAt: new Date(r.created_at).toISOString(),
  };
}

export interface ApprovalRow extends ExpertProfileRow {
  first_name: string | null;
  last_name: string | null;
  email: string;
}

export function mapApprovalItem(r: ApprovalRow): ExpertApprovalItem {
  const p = mapExpertProfile(r);
  return {
    userId: p.userId,
    fullName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    email: r.email,
    headline: p.headline,
    summary: p.summary,
    skills: p.skills,
    domains: p.domains,
    yearsExperience: p.yearsExperience,
    hourlyRate: p.hourlyRate,
    dailyRate: p.dailyRate,
    currency: p.currency,
    portfolioUrl: p.portfolioUrl,
    linkedinUrl: p.linkedinUrl,
    githubUrl: p.githubUrl,
    completion: p.completion,
    status: p.status,
    adminNote: p.adminNote,
    reviewedAt: p.reviewedAt,
    updatedAt: p.updatedAt ?? '',
  };
}
