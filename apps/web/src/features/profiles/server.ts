// Server components only (uses `next.revalidate`); don't import from client code.
import type { ExpertDetail, ExpertPage } from './types';
import type { ExpertFilters } from './format';

/**
 * Server-side reads of the public directory. Server components can't use the relative
 * `/api/v1` rewrite, so they call the API directly (API_INTERNAL_URL inside the cluster,
 * else the public API URL, else the local dev API).
 */
const ORIGIN = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');
const BASE = `${ORIGIN}/api/v1`;

/** Directory pages change when admins approve someone; a minute of caching is plenty. */
const REVALIDATE = 60;

export class DirectoryUnavailable extends Error {}

async function get<T>(path: string): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, { next: { revalidate: REVALIDATE }, headers: { Accept: 'application/json' } });
  } catch {
    throw new DirectoryUnavailable('The expert directory is unavailable right now.');
  }
  if (res.status === 404 || res.status === 400) return null;
  if (!res.ok) throw new DirectoryUnavailable('The expert directory is unavailable right now.');
  const json = (await res.json()) as { data: T };
  return json.data;
}

export async function fetchExperts(f: ExpertFilters): Promise<ExpertPage> {
  const qs = new URLSearchParams();
  Object.entries({ ...f, pageSize: 12 }).forEach(([k, v]) => {
    if (v !== undefined && v !== '') qs.set(k, String(v));
  });
  return (await get<ExpertPage>(`/experts?${qs}`)) ?? { items: [], total: 0, page: 1, pageSize: 12 };
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** The public (approved) profile, or null. Owners / admins see unapproved ones client-side. */
export async function fetchExpert(id: string): Promise<ExpertDetail | null> {
  if (!UUID.test(id)) return null;
  return get<ExpertDetail>(`/experts/${encodeURIComponent(id)}`);
}
