import type { Availability, EngagementMode, ExpertCard, ExpertProfileStatus, ExpertSort } from './types';
import { AVAILABILITIES, ENGAGEMENT_MODES, EXPERT_SORTS } from './types';

export const ENGAGEMENT_LABEL: Record<EngagementMode, string> = {
  hourly: 'Hourly', daily: 'Daily', fixed: 'Fixed price', sprint: 'Sprint',
};

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  available: 'Available now', limited: 'Limited availability', unavailable: 'Not available',
};

export const STATUS_LABEL: Record<ExpertProfileStatus, string> = {
  draft: 'Draft', pending: 'Pending review', approved: 'Approved', rejected: 'Not approved', rework: 'Changes requested',
};

export function money(amount: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-IN', { style: 'currency', currency, maximumFractionDigits: 0 }).format(amount);
  } catch {
    return `${currency} ${Math.round(amount)}`;
  }
}

/** The headline rate of a card: hourly, else daily, else "from" a fixed price. */
export function primaryRate(e: Pick<ExpertCard, 'hourlyRate' | 'dailyRate' | 'fixedFrom' | 'currency'>): string | null {
  if (e.hourlyRate !== null) return `${money(e.hourlyRate, e.currency)}/hr`;
  if (e.dailyRate !== null) return `${money(e.dailyRate, e.currency)}/day`;
  if (e.fixedFrom !== null) return `from ${money(e.fixedFrom, e.currency)}`;
  return null;
}

/** Directory filters as read from the URL. Unknown or junk values are dropped. */
export interface ExpertFilters {
  q?: string;
  domain?: string;
  skill?: string;
  minRate?: number;
  maxRate?: number;
  availability?: Availability;
  engagement?: EngagementMode;
  sort?: ExpertSort;
  page?: number;
}

type RawParams = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)?.trim() || undefined;
const pick = <T extends string>(v: string | undefined, allowed: readonly T[]) =>
  v && (allowed as readonly string[]).includes(v) ? (v as T) : undefined;
const positive = (v: string | undefined) => {
  const n = v === undefined ? NaN : Number(v);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};

export function parseFilters(params: RawParams): ExpertFilters {
  const page = positive(first(params.page));
  return {
    q: first(params.q)?.slice(0, 200),
    domain: first(params.domain)?.slice(0, 40),
    skill: first(params.skill)?.slice(0, 40),
    minRate: positive(first(params.minRate)),
    maxRate: positive(first(params.maxRate)),
    availability: pick(first(params.availability), AVAILABILITIES),
    engagement: pick(first(params.engagement), ENGAGEMENT_MODES),
    sort: pick(first(params.sort), EXPERT_SORTS),
    page: page && page >= 1 ? Math.floor(page) : undefined,
  };
}

/** A `?query` for the directory with the given filters (empty values left out). */
export function filtersToQuery(f: ExpertFilters): string {
  const qs = new URLSearchParams();
  Object.entries(f).forEach(([k, v]) => {
    if (v !== undefined && v !== '' && !(k === 'page' && v === 1)) qs.set(k, String(v));
  });
  const s = qs.toString();
  return s ? `?${s}` : '';
}
