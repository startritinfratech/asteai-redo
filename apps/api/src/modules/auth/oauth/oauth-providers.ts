/**
 * Google and GitHub OAuth 2.0 (authorization code flow), over plain fetch.
 * Each provider turns an access token into the one profile shape OAuthService needs.
 * Only a provider-verified email is accepted, since it is what links to an existing account.
 */
export const OAUTH_PROVIDERS = ['google', 'github'] as const;
export type OAuthProviderName = (typeof OAUTH_PROVIDERS)[number];

export const isOAuthProvider = (v: string): v is OAuthProviderName =>
  (OAUTH_PROVIDERS as readonly string[]).includes(v);

export interface OAuthProfile {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName: string;
  lastName: string;
  avatarUrl: string | null;
}

export interface OAuthProviderSpec {
  authorizeUrl: string;
  tokenUrl: string;
  scope: string;
  /** Google supports PKCE; GitHub is sent the client secret only. */
  pkce: boolean;
  fetchProfile(accessToken: string, http: typeof fetch): Promise<OAuthProfile>;
}

const TIMEOUT_MS = 10_000;

async function getJson<T>(http: typeof fetch, url: string, accessToken: string): Promise<T> {
  const res = await http(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json', 'User-Agent': 'asteai-api' },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`profile request failed (${res.status})`);
  return (await res.json()) as T;
}

function splitName(full: string | null | undefined, fallback: string): [string, string] {
  const parts = (full ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return [fallback, ''];
  return [parts[0], parts.slice(1).join(' ')];
}

export const PROVIDER_SPECS: Record<OAuthProviderName, OAuthProviderSpec> = {
  google: {
    authorizeUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenUrl: 'https://oauth2.googleapis.com/token',
    scope: 'openid email profile',
    pkce: true,
    async fetchProfile(accessToken, http) {
      const p = await getJson<{
        sub: string; email?: string; email_verified?: boolean; given_name?: string; family_name?: string;
        name?: string; picture?: string;
      }>(http, 'https://openidconnect.googleapis.com/v1/userinfo', accessToken);
      const [first, last] = splitName(p.name, 'Google user');
      return {
        providerUserId: String(p.sub),
        email: (p.email ?? '').toLowerCase(),
        emailVerified: p.email_verified === true,
        firstName: p.given_name || first,
        lastName: p.family_name ?? last,
        avatarUrl: p.picture ?? null,
      };
    },
  },
  github: {
    authorizeUrl: 'https://github.com/login/oauth/authorize',
    tokenUrl: 'https://github.com/login/oauth/access_token',
    scope: 'read:user user:email',
    pkce: false,
    async fetchProfile(accessToken, http) {
      const u = await getJson<{ id: number; login: string; name: string | null; avatar_url?: string }>(
        http, 'https://api.github.com/user', accessToken,
      );
      // The profile email may be hidden or unverified: take the primary verified one.
      const emails = await getJson<{ email: string; primary: boolean; verified: boolean }[]>(
        http, 'https://api.github.com/user/emails', accessToken,
      );
      const primary = emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified);
      const [first, last] = splitName(u.name, u.login);
      return {
        providerUserId: String(u.id),
        email: (primary?.email ?? '').toLowerCase(),
        emailVerified: !!primary,
        firstName: first,
        lastName: last,
        avatarUrl: u.avatar_url ?? null,
      };
    },
  },
};
