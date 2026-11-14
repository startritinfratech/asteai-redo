/**
 * Typed fetch wrapper for the AsteAI NestJS backend.
 *
 * - Sends the HttpOnly session cookies (`credentials: 'include'`); the page never sees a token.
 * - On a 401 it refreshes the session once (shared by all concurrent requests, because
 *   refresh tokens are single-use) and retries the request.
 * - Without the session hint cookie (anonymous visitor) a 401 never triggers a refresh.
 * - Unwraps the API's `{ data }` envelope and throws `ApiError` for non-2xx responses.
 */
import { hasSessionHint } from './tokens';

export const API_BASE = process.env.NEXT_PUBLIC_API_URL
  ? `${process.env.NEXT_PUBLIC_API_URL.replace(/\/$/, '')}/api/v1`
  : '/api/v1';

type QueryParams = Record<string, string | number | boolean | undefined>;

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  params?: QueryParams;
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

/** Called when the session can no longer be refreshed (set by the auth store). */
let onSessionExpired: (() => void) | null = null;
export function setSessionExpiredHandler(handler: () => void) {
  onSessionExpired = handler;
}

function buildUrl(path: string, params?: QueryParams): string {
  const query = new URLSearchParams();
  Object.entries(params ?? {}).forEach(([k, v]) => {
    if (v !== undefined) query.set(k, String(v));
  });
  const qs = query.toString();
  return `${API_BASE}${path}${qs ? `?${qs}` : ''}`;
}

let refreshInFlight: Promise<boolean> | null = null;

/**
 * Rotates the session: the API reads the refresh cookie and sets new cookies. Concurrent
 * callers share one request. Another tab may rotate the (single-use) token first, so a
 * refused refresh is not final: the caller retries its request once, with whatever
 * cookies the browser holds by then.
 */
function refreshSession(): Promise<boolean> {
  if (refreshInFlight) return refreshInFlight;
  refreshInFlight = fetch(`${API_BASE}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshInFlight = null;
    });
  return refreshInFlight;
}

/**
 * Public auth endpoints, called without (or regardless of) a session. A 401 from them is
 * an answer (wrong password, bad or used token), not an expired access token, so it never
 * triggers a refresh. Signed-in /auth/* endpoints (2FA settings, sessions, password
 * change, /auth/verify-email/send) refresh on 401 like any other request.
 */
const PUBLIC_AUTH_PATHS = new Set([
  '/auth/login',
  '/auth/login/2fa',
  '/auth/register',
  '/auth/refresh',
  '/auth/logout',
  '/auth/password/forgot',
  '/auth/password/reset',
  '/auth/verify-email',
  '/auth/email/send-otp',
  '/auth/email/verify-otp',
]);

/** Whether a 401 from `path` may be retried after refreshing the tokens (exact match, query ignored). */
export function refreshesOn401(path: string): boolean {
  return !PUBLIC_AUTH_PATHS.has(path.split(/[?#]/, 1)[0]);
}

async function errorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => null)) as { message?: string | string[] } | null;
  const raw = body?.message;
  const message = Array.isArray(raw) ? raw.join(', ') : raw || `Request failed (${response.status})`;
  return new ApiError(message, response.status, body);
}

/**
 * Sends an authenticated request and returns the raw Response (for downloads etc.).
 * Public auth endpoints never trigger a refresh: a 401 from /auth/login is a wrong password.
 */
export async function apiRequest(path: string, options: RequestOptions = {}, retry = true): Promise<Response> {
  const { body, params, headers: extraHeaders, ...init } = options;
  const headers = new Headers(extraHeaders);
  if (body !== undefined) headers.set('Content-Type', 'application/json');

  const response = await fetch(buildUrl(path, params), {
    ...init,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  if (response.status === 401 && refreshesOn401(path)) {
    if (retry && hasSessionHint()) {
      // Refreshed by us, or (if ours was refused) possibly by another tab: retry once either way.
      await refreshSession();
      return apiRequest(path, options, false);
    }
    onSessionExpired?.();
    throw new ApiError('Your session has expired. Please sign in again.', 401);
  }

  if (!response.ok) throw await errorFrom(response);
  return response;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const response = await apiRequest(path, options);
  if (response.status === 204) return undefined as T;
  const text = await response.text();
  if (!text) return undefined as T;
  const json = JSON.parse(text) as { data?: T } | T;
  return (json && typeof json === 'object' && 'data' in json ? json.data : json) as T;
}

export const api = {
  get: <T>(path: string, params?: QueryParams) => apiFetch<T>(path, { method: 'GET', params }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  delete: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

/** SWR fetcher: `useSWR<T>(path, fetcher)`. */
export const fetcher = <T>(path: string) => api.get<T>(path);

/** A readable message for anything a request might throw. */
export function errorMessage(err: unknown, fallback = 'Something went wrong'): string {
  return err instanceof Error && err.message ? err.message : fallback;
}
