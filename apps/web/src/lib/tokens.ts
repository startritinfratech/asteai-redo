/**
 * The browser no longer holds auth tokens: the API keeps them in HttpOnly cookies that
 * JavaScript cannot read. What the web app can see is `asteai_session`, a non-secret hint
 * cookie the API sets alongside them (and clears on logout). It answers one question
 * without a request: "might there be a session?" Public pages use it to avoid calling
 * `/users/me` (or refreshing) for anonymous visitors.
 */
export const SESSION_HINT_COOKIE = 'asteai_session';

/** Token keys older builds kept in localStorage; removed on first load. */
const LEGACY_KEYS = ['accessToken', 'refreshToken', 'userId'];

export function hasSessionHint(): boolean {
  if (typeof document === 'undefined') return false;
  return document.cookie.split(';').some((c) => c.trim().startsWith(`${SESSION_HINT_COOKIE}=`));
}

/** Drops tokens a previous build left in localStorage (they are useless and readable by any script). */
export function clearLegacyTokens(): void {
  if (typeof window === 'undefined') return;
  try {
    LEGACY_KEYS.forEach((k) => window.localStorage.removeItem(k));
  } catch {
    // Storage blocked: nothing to clear.
  }
}
