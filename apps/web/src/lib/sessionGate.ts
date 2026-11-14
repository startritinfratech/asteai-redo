/**
 * Edge-side session gate (used by src/middleware.ts), kept free of Next imports so it is
 * unit-tested directly.
 *
 * The page can't read the HttpOnly session cookies, and neither should the gate need to:
 * the API sets the readable `asteai_session` hint alongside them. No hint means nobody is
 * signed in, so a /platform page is answered with a redirect to sign-in before any client
 * code (or any `/users/me` request) runs. A hint that turns out stale is handled by the
 * client: the API answers 401, the refresh fails, and the shell sends the user to sign in.
 */
import { LOGIN_PATH } from './routes';
import { SESSION_HINT_COOKIE } from './tokens';

export const PROTECTED_PREFIX = '/platform';

export function isProtectedPath(pathname: string): boolean {
  return pathname === PROTECTED_PREFIX || pathname.startsWith(`${PROTECTED_PREFIX}/`);
}

/** Where to send a request, or null to let it through. */
export function sessionRedirect(pathname: string, search: string, hasHint: boolean): string | null {
  if (!isProtectedPath(pathname) || hasHint) return null;
  return `${LOGIN_PATH}?next=${encodeURIComponent(`${pathname}${search}`)}`;
}

export { SESSION_HINT_COOKIE };
