/**
 * The public job board query: open, public requisitions of non-test tenants that have not
 * expired, newest first, with keyset pagination on (published_at, id).
 * Kept free of Nest so the SQL builder and cursor codec are unit-tested directly.
 */
import type { EmploymentType, JobLocationType, PublicJob } from '@asteai/types';

export const JOB_PAGE_MAX = 50;

/** Visible on the board: the one definition both the list and the detail use. */
export const PUBLIC_JOB_WHERE = `r.is_public AND r.status = 'Open' AND NOT t.is_test
  AND r.published_at IS NOT NULL AND (r.expires_at IS NULL OR r.expires_at > NOW())`;

export const PUBLIC_JOB_SELECT = `
  r.id, r.title, r.func, r.brief, r.location_type, r.location, r.salary_min, r.salary_max, r.salary_currency,
  r.requirements, r.employment_type, r.frontline_role, r.published_at, r.expires_at,
  t.name AS company_name, t.logo_url AS company_logo, t.website AS company_website,
  (SELECT COUNT(*) FROM applications a WHERE a.requisition_id = r.id)::int AS application_count`;

export interface PublicJobRow {
  id: string; title: string; func: string; brief: string | null; location_type: JobLocationType; location: string | null;
  salary_min: string | null; salary_max: string | null; salary_currency: string; requirements: string[];
  employment_type: EmploymentType; frontline_role: string | null; published_at: Date; expires_at: Date | null;
  company_name: string; company_logo: string | null; company_website: string | null; application_count: number;
}

const num = (v: string | null) => (v === null ? null : Number(v));

export function mapPublicJob(r: PublicJobRow): PublicJob {
  return {
    id: r.id,
    title: r.title,
    department: r.func || null,
    description: r.brief ?? '',
    locationType: r.location_type,
    location: r.location,
    salaryMin: num(r.salary_min),
    salaryMax: num(r.salary_max),
    salaryCurrency: r.salary_currency,
    requirements: r.requirements ?? [],
    employmentType: r.employment_type,
    frontlineRole: r.frontline_role,
    createdAt: r.published_at.toISOString(),
    expiresAt: r.expires_at ? r.expires_at.toISOString() : null,
    applicationCount: r.application_count,
    company: { name: r.company_name, logoUrl: r.company_logo, website: r.company_website },
  };
}

export interface JobCursor { publishedAt: string; id: string }

export function encodeCursor(c: JobCursor): string {
  return Buffer.from(`${c.publishedAt}|${c.id}`, 'utf8').toString('base64url');
}

/** null for anything malformed (treated as "first page"), never a thrown error. */
export function decodeCursor(raw: string | undefined): JobCursor | null {
  if (!raw) return null;
  let text: string;
  try {
    text = Buffer.from(raw, 'base64url').toString('utf8');
  } catch {
    return null;
  }
  const [publishedAt, id, extra] = text.split('|');
  if (extra !== undefined || !publishedAt || !id || Number.isNaN(Date.parse(publishedAt)) || !/^[\w-]{1,32}$/.test(id)) return null;
  return { publishedAt, id };
}

export interface JobFilters {
  q?: string;
  locationType?: JobLocationType;
  employmentType?: EmploymentType;
}

/** WHERE clause + params for the filters (shared by the page query and the total count). */
export function buildJobFilters(f: JobFilters): { where: string; params: unknown[] } {
  const params: unknown[] = [];
  const parts = [PUBLIC_JOB_WHERE];
  if (f.q) {
    params.push(`%${f.q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`);
    const p = `$${params.length}`;
    parts.push(`(r.title ILIKE ${p} OR r.func ILIKE ${p} OR t.name ILIKE ${p} OR r.location ILIKE ${p} OR array_to_string(r.stack, ' ') ILIKE ${p})`);
  }
  if (f.locationType) {
    params.push(f.locationType);
    parts.push(`r.location_type = $${params.length}`);
  }
  if (f.employmentType) {
    params.push(f.employmentType);
    parts.push(`r.employment_type = $${params.length}`);
  }
  return { where: parts.join(' AND '), params };
}
