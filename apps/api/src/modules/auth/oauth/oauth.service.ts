import {
  ForbiddenException, Inject, Injectable, NotFoundException, Optional, UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomBytes, timingSafeEqual } from 'crypto';
import { Pool } from 'pg';
import type { TwoFactorChallengeResponse, User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../../database/database.module';
import { mapUserRow, USER_COLUMNS, UserRow } from '../../users/user.mapper';
import { ACCOUNT_ACTIVE_SQL, BlockColumns, isBlocked } from '../account-status';
import type { AuthTokens, SessionMeta } from '../auth.service';
import { TwoFactorService } from '../two-factor.service';
import { OAuthProfile, OAuthProviderName, OAuthProviderSpec, PROVIDER_SPECS } from './oauth-providers';

export const OAUTH_HTTP = 'OAUTH_HTTP';
export const OAUTH_STATE_COOKIE = 'asteai_oauth';
export const OAUTH_STATE_TTL_S = 600;
const STATE_PURPOSE = 'oauth_state';

/** Roles a visitor may pick for themselves at sign-up (same list as RegisterDto). */
export const SELF_SERVE_ROLES = ['Employer', 'Candidate', 'Freelancer', 'Buyer'] as const;
export type SelfServeRole = (typeof SELF_SERVE_ROLES)[number];
const selfServeRole = (v: unknown): SelfServeRole =>
  (SELF_SERVE_ROLES as readonly unknown[]).includes(v) ? (v as SelfServeRole) : 'Candidate';

interface StatePayload {
  purpose: typeof STATE_PURPOSE;
  provider: OAuthProviderName;
  state: string;
  verifier?: string;
  next: string;
  /** Role for an account this sign-in creates (from the sign-up page); ignored for existing accounts. */
  role: SelfServeRole;
}

export interface OAuthStart {
  /** Where to send the browser. */
  url: string;
  /** Signed value for the short-lived HttpOnly state cookie. */
  stateCookie: string;
}

/** Where the callback lands: signed in, or a 2FA challenge still to answer. */
export type OAuthResult =
  | { kind: 'session'; tokens: AuthTokens; next: string }
  | { kind: 'challenge'; challenge: TwoFactorChallengeResponse; next: string };

/** Only same-origin relative paths: `/x`, never `//evil.com` or `/\\evil.com`. */
export function safeNext(next: unknown): string {
  return typeof next === 'string' && /^\/(?![/\\])/.test(next) && next.length <= 300 ? next : '/';
}

const b64url = (buf: Buffer) => buf.toString('base64url');

function sameString(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/**
 * Sign-in with Google or GitHub.
 *
 * - `state` (CSRF) and the PKCE verifier live in a signed, HttpOnly, 10-minute cookie
 *   scoped to the OAuth path, so nothing is stored server-side between the two legs.
 * - A provider identity links to the account with the same email only when the provider
 *   says the email is verified; otherwise there is no sign-in at all.
 * - New accounts start verified, with no password (auth_provider = the provider), in the
 *   self-serve role picked on the sign-up page (Candidate by default). The sign-up page
 *   states that continuing with a provider accepts the terms, so they are recorded.
 * - Accounts with 2FA still need their second factor: the result is then a challenge.
 */
@Injectable()
export class OAuthService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly config: ConfigService,
    private readonly jwt: JwtService,
    private readonly twoFactor: TwoFactorService,
    @Optional() @Inject(OAUTH_HTTP) private readonly http: typeof fetch = fetch,
  ) {}

  private credentials(provider: OAuthProviderName): { clientId: string; clientSecret: string } {
    const key = provider.toUpperCase();
    const clientId = this.config.get<string>(`${key}_CLIENT_ID`);
    const clientSecret = this.config.get<string>(`${key}_CLIENT_SECRET`);
    if (!clientId || !clientSecret) throw new NotFoundException(`${provider} sign-in is not enabled`);
    return { clientId, clientSecret };
  }

  redirectUri(provider: OAuthProviderName): string {
    const base = this.config.get<string>('OAUTH_CALLBACK_BASE_URL', 'http://localhost:3001').replace(/\/$/, '');
    return `${base}/api/v1/auth/oauth/${provider}/callback`;
  }

  start(provider: OAuthProviderName, next: unknown, role?: unknown): OAuthStart {
    const spec = PROVIDER_SPECS[provider];
    const { clientId } = this.credentials(provider);
    const state = b64url(randomBytes(24));
    const verifier = spec.pkce ? b64url(randomBytes(32)) : undefined;

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: this.redirectUri(provider),
      response_type: 'code',
      scope: spec.scope,
      state,
    });
    if (verifier) {
      params.set('code_challenge', b64url(createHash('sha256').update(verifier).digest()));
      params.set('code_challenge_method', 'S256');
    }
    if (provider === 'google') params.set('prompt', 'select_account');

    const payload: StatePayload = {
      purpose: STATE_PURPOSE, provider, state, verifier, next: safeNext(next), role: selfServeRole(role),
    };
    const stateCookie = this.jwt.sign(payload, { expiresIn: OAUTH_STATE_TTL_S });
    return { url: `${spec.authorizeUrl}?${params}`, stateCookie };
  }

  /** Checks state, trades the code, and signs in (or returns the 2FA challenge). */
  async callback(
    provider: OAuthProviderName, code: unknown, state: unknown, stateCookie: unknown, meta: SessionMeta,
  ): Promise<OAuthResult> {
    const saved = this.readState(stateCookie);
    if (!saved || saved.provider !== provider || typeof state !== 'string' || !sameString(saved.state, state)) {
      throw new UnauthorizedException('oauth_state');
    }
    if (typeof code !== 'string' || !code || code.length > 2000) throw new UnauthorizedException('oauth_code');

    const spec = PROVIDER_SPECS[provider];
    const accessToken = await this.exchangeCode(provider, spec, code, saved.verifier);
    let profile: OAuthProfile;
    try {
      profile = await spec.fetchProfile(accessToken, this.http);
    } catch {
      throw new UnauthorizedException('oauth_profile');
    }
    if (!profile.emailVerified || !profile.email) throw new ForbiddenException('oauth_unverified_email');

    const user = await this.findOrCreateUser(provider, profile, selfServeRole(saved.role));
    const out = await this.twoFactor.startLogin(user, meta);
    return 'twoFactorRequired' in out
      ? { kind: 'challenge', challenge: out, next: saved.next }
      : { kind: 'session', tokens: out, next: saved.next };
  }

  private readState(cookie: unknown): StatePayload | null {
    if (typeof cookie !== 'string' || !cookie) return null;
    try {
      const p = this.jwt.verify<StatePayload>(cookie);
      return p.purpose === STATE_PURPOSE ? p : null;
    } catch {
      return null;
    }
  }

  private async exchangeCode(
    provider: OAuthProviderName, spec: OAuthProviderSpec, code: string, verifier?: string,
  ): Promise<string> {
    const { clientId, clientSecret } = this.credentials(provider);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: this.redirectUri(provider),
    });
    if (verifier) body.set('code_verifier', verifier);
    let json: { access_token?: unknown } | null = null;
    try {
      const res = await this.http(spec.tokenUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
        body,
        signal: AbortSignal.timeout(10_000),
      });
      json = res.ok ? ((await res.json()) as { access_token?: unknown }) : null;
    } catch {
      json = null;
    }
    if (typeof json?.access_token !== 'string') throw new UnauthorizedException('oauth_code');
    return json.access_token;
  }

  /**
   * 1. A known provider identity → its account.
   * 2. Else an account with the same (provider-verified) email → link the identity to it.
   * 3. Else a new account.
   * Banned or suspended accounts are refused either way.
   */
  async findOrCreateUser(provider: OAuthProviderName, p: OAuthProfile, role: SelfServeRole = 'Candidate'): Promise<User> {
    const row = await withTransaction(this.db, async (client) => {
      const linked = await client.query<UserRow & BlockColumns>(
        `SELECT ${USER_COLUMNS}, is_banned, is_suspended, suspended_until
           FROM user_accounts
          WHERE id = (SELECT user_id FROM user_oauth_identities WHERE provider = $1 AND provider_user_id = $2)
            AND ${ACCOUNT_ACTIVE_SQL}`,
        [provider, p.providerUserId],
      );
      if (linked.rows.length) return linked.rows[0];

      const existing = await client.query<UserRow & BlockColumns>(
        `SELECT ${USER_COLUMNS}, is_banned, is_suspended, suspended_until
           FROM user_accounts
          WHERE (email_canonical = LOWER($1) OR LOWER(email) = LOWER($1)) AND ${ACCOUNT_ACTIVE_SQL}
          FOR UPDATE`,
        [p.email],
      );
      let account = existing.rows[0];
      if (account) {
        // The provider proved the address, so it is verified for this account too.
        await client.query(`UPDATE user_accounts SET email_verified = TRUE, updated_at = NOW() WHERE id = $1`, [account.id]);
      } else {
        const created = await client.query<UserRow & BlockColumns>(
          `INSERT INTO user_accounts
             (email, email_canonical, first_name, last_name, role, avatar_url, auth_provider, email_verified,
              terms_accepted, terms_accepted_at)
           VALUES ($1, LOWER($1), $2, $3, $6::user_role_enum, $4, $5, TRUE, TRUE, NOW())
           RETURNING ${USER_COLUMNS}, is_banned, is_suspended, suspended_until`,
          [p.email, p.firstName.slice(0, 100), p.lastName.slice(0, 100), p.avatarUrl, provider, role],
        );
        account = created.rows[0];
      }
      await client.query(
        `INSERT INTO user_oauth_identities (provider, provider_user_id, user_id, email)
         VALUES ($1, $2, $3, $4) ON CONFLICT (provider, provider_user_id) DO NOTHING`,
        [provider, p.providerUserId, account.id, p.email],
      );
      return account;
    });
    if (isBlocked(row)) throw new ForbiddenException('oauth_suspended');
    return mapUserRow(row);
  }
}
