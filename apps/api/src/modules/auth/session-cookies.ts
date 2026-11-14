import type { ConfigService } from '@nestjs/config';
import type { CookieOptions, Request, Response } from 'express';
import type { SessionResponse } from '@asteai/types';
import type { AuthTokens } from './auth.service';
import { parseDuration } from './auth.service';

/**
 * Session cookies. The browser never sees the tokens: both are `HttpOnly; Secure;
 * SameSite=Lax`. The web app learns whether it is signed in from the response body
 * (`SessionResponse`) and from the non-secret `asteai_session` hint cookie, which lets
 * public pages skip `/users/me` entirely when nobody is signed in.
 *
 *   asteai_at       access JWT, path /           (read by JwtStrategy and the chat socket)
 *   asteai_rt       `<userId>.<refresh token>`, path /api/v1/auth (refresh + logout only)
 *   asteai_session  "1", readable by JS, no secret
 */
export const ACCESS_COOKIE = 'asteai_at';
export const REFRESH_COOKIE = 'asteai_rt';
export const SESSION_HINT_COOKIE = 'asteai_session';
export const AUTH_COOKIE_PATH = '/api/v1/auth';

export interface CookieSettings {
  secure: boolean;
  /** e.g. `.asteai.com`, so web (asteai.com) and API (api.asteai.com) share the hint cookie. */
  domain?: string;
  accessMaxAgeMs: number;
  refreshMaxAgeMs: number;
}

export type { SessionResponse };

export function cookieSettings(config: Pick<ConfigService, 'get'>): CookieSettings {
  return {
    // Browsers accept Secure cookies on http://localhost, so this stays on in development too.
    secure: config.get<string>('COOKIE_SECURE') !== 'false',
    domain: config.get<string>('COOKIE_DOMAIN') || undefined,
    accessMaxAgeMs: parseDuration(config.get<string>('JWT_EXPIRES_IN', '15m')),
    refreshMaxAgeMs: parseDuration(config.get<string>('JWT_REFRESH_EXPIRES_IN', '7d')),
  };
}

function base(s: CookieSettings): CookieOptions {
  return { httpOnly: true, secure: s.secure, sameSite: 'lax', domain: s.domain };
}

export function isAuthTokens(body: unknown): body is AuthTokens {
  const b = body as Partial<AuthTokens> | null;
  return !!b && typeof b === 'object'
    && typeof b.accessToken === 'string' && typeof b.refreshToken === 'string' && !!b.user;
}

export function setSessionCookies(res: Pick<Response, 'cookie'>, tokens: AuthTokens, s: CookieSettings): SessionResponse {
  res.cookie(ACCESS_COOKIE, tokens.accessToken, { ...base(s), path: '/', maxAge: s.accessMaxAgeMs });
  res.cookie(REFRESH_COOKIE, `${tokens.user.id}.${tokens.refreshToken}`, {
    ...base(s), path: AUTH_COOKIE_PATH, maxAge: s.refreshMaxAgeMs,
  });
  res.cookie(SESSION_HINT_COOKIE, '1', { ...base(s), httpOnly: false, path: '/', maxAge: s.refreshMaxAgeMs });
  return { user: tokens.user, sessionId: tokens.refreshToken.split('.', 1)[0] };
}

export function clearSessionCookies(res: Pick<Response, 'clearCookie'>, s: CookieSettings): void {
  res.clearCookie(ACCESS_COOKIE, { ...base(s), path: '/' });
  res.clearCookie(REFRESH_COOKIE, { ...base(s), path: AUTH_COOKIE_PATH });
  res.clearCookie(SESSION_HINT_COOKIE, { ...base(s), httpOnly: false, path: '/' });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** `{ userId, refreshToken }` from the refresh cookie, or null when absent or malformed. */
export function readRefreshCookie(req: Pick<Request, 'cookies'>): { userId: string; refreshToken: string } | null {
  const raw = (req.cookies as Record<string, unknown> | undefined)?.[REFRESH_COOKIE];
  if (typeof raw !== 'string' || raw.length > 300) return null;
  const dot = raw.indexOf('.');
  const userId = raw.slice(0, dot);
  const refreshToken = raw.slice(dot + 1);
  if (dot < 0 || !UUID.test(userId) || !refreshToken.includes('.')) return null;
  return { userId, refreshToken };
}

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Passport extractor for the access cookie. SameSite=Lax already keeps the cookie off
 * cross-site POSTs; for state-changing requests this also refuses an `Origin` that is not
 * one of the web app's (a sibling subdomain is "same-site" but not trusted).
 */
export function accessTokenFromCookie(allowedOrigins: readonly string[]) {
  return (req: Request): string | null => {
    const token = (req.cookies as Record<string, unknown> | undefined)?.[ACCESS_COOKIE];
    if (typeof token !== 'string' || !token || token.length > 4096) return null;
    if (!SAFE_METHODS.has(req.method)) {
      const origin = req.headers.origin;
      if (origin && !allowedOrigins.includes(origin)) return null;
    }
    return token;
  };
}

/** Reads one cookie from a raw `Cookie` header (the socket.io handshake has no cookie-parser). */
export function cookieFromHeader(header: string | undefined, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq < 0 || part.slice(0, eq).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(eq + 1).trim());
    } catch {
      return null;
    }
  }
  return null;
}

export function allowedOrigins(config: Pick<ConfigService, 'get'>): string[] {
  return config.get<string>('CORS_ORIGINS', 'http://localhost:3000').split(',').map((o) => o.trim()).filter(Boolean);
}
