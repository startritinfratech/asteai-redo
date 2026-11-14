/** Provider sign-in links and messages (plain module, so specs can import it without CSS). */
import { API_BASE } from '@/lib/api';

export const OAUTH_PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
  { id: 'github', label: 'Continue with GitHub' },
] as const;

export type OAuthProviderId = (typeof OAUTH_PROVIDERS)[number]['id'];

/**
 * The API endpoint that starts a provider sign-in. It is a full-page navigation (not
 * fetch): the API answers with a redirect to Google / GitHub and, on the way back, sets
 * the HttpOnly session cookies and lands on /auth/login?oauth=success.
 */
export function oauthStartUrl(provider: OAuthProviderId, opts: { next?: string | null; role?: string | null } = {}): string {
  const q = new URLSearchParams();
  if (opts.next) q.set('next', opts.next);
  if (opts.role) q.set('role', opts.role);
  const qs = q.toString();
  return `${API_BASE}/auth/oauth/${provider}${qs ? `?${qs}` : ''}`;
}

/** Messages for `?oauth_error=` from the API's OAuth callback. */
export const OAUTH_ERRORS: Record<string, string> = {
  cancelled: 'Sign-in was cancelled.',
  state: 'That sign-in link expired. Please try again.',
  code: 'The provider did not confirm the sign-in. Please try again.',
  profile: 'We could not read your profile from the provider. Please try again.',
  unverified_email: 'That account has no verified email address. Verify it with the provider, or use email instead.',
  suspended: 'This account is suspended.',
};
