/**
 * Server-side reads for public pages (RSC). The browser `/api/v1` rewrite is not available
 * here, so this calls the API origin directly and unwraps the `{ data }` envelope.
 */
const ORIGIN = (process.env.API_INTERNAL_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001').replace(/\/$/, '');

/** The API could not be reached or answered with a server error / unknown route. */
export class ApiUnavailable extends Error {}

/** The API answered 404 for this resource. */
export class ApiNotFound extends Error {}

export async function serverGet<T>(
  path: string,
  { revalidate = 60, params }: { revalidate?: number; params?: Record<string, string | number | undefined> } = {},
): Promise<T> {
  const url = new URL(`${ORIGIN}/api/v1${path}`);
  for (const [k, v] of Object.entries(params ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v));
  }
  let res: Response;
  try {
    res = await fetch(url, { next: { revalidate }, headers: { Accept: 'application/json' } });
  } catch {
    throw new ApiUnavailable('The service is temporarily unavailable.');
  }
  if (res.status === 404) throw new ApiNotFound('Not found');
  if (!res.ok) throw new ApiUnavailable('The service is temporarily unavailable.');
  const json = (await res.json()) as { data?: T } | T;
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}
