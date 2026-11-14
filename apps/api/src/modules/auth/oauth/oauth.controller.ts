import { Controller, Get, HttpException, Logger, NotFoundException, Param, Query, Req, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { sessionMetaFrom } from '../auth.service';
import { allowedOrigins, cookieSettings, setSessionCookies, type CookieSettings } from '../session-cookies';
import { isOAuthProvider, type OAuthProviderName } from './oauth-providers';
import { OAUTH_STATE_COOKIE, OAUTH_STATE_TTL_S, OAuthService } from './oauth.service';

/**
 * Browser redirects only (no JSON):
 *   GET /auth/oauth/:provider?next=/path&role=Freelancer   → 302 to Google / GitHub
 *     (role only applies when the sign-in creates a new account)
 *   GET /auth/oauth/:provider/callback     → session cookies set, 302 to the web app:
 *     signed in        {WEB}/auth/login?oauth=success&next=/path
 *     2FA required     {WEB}/auth/login?next=/path#challenge=…   (fragment: never sent to a server)
 *     failed           {WEB}/auth/login?oauth_error=<code>
 */
@ApiTags('auth')
@Controller('auth/oauth')
export class OAuthController {
  private readonly logger = new Logger(OAuthController.name);
  private readonly cookies: CookieSettings;
  private readonly webUrl: string;

  constructor(private readonly oauth: OAuthService, config: ConfigService) {
    this.cookies = cookieSettings(config);
    this.webUrl = (config.get<string>('WEB_APP_URL') || allowedOrigins(config)[0] || 'http://localhost:3000').replace(/\/$/, '');
  }

  private provider(name: string): OAuthProviderName {
    if (!isOAuthProvider(name)) throw new NotFoundException();
    return name;
  }

  private stateCookieOptions(provider: OAuthProviderName) {
    return {
      httpOnly: true, secure: this.cookies.secure, sameSite: 'lax' as const, domain: this.cookies.domain,
      path: `/api/v1/auth/oauth/${provider}`,
    };
  }

  @Get(':provider')
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Start Google / GitHub sign-in (302 to the provider)' })
  start(
    @Param('provider') name: string,
    @Query('next') next: string | undefined,
    @Query('role') role: string | undefined,
    @Res() res: Response,
  ) {
    const provider = this.provider(name);
    const { url, stateCookie } = this.oauth.start(provider, next, role);
    res.cookie(OAUTH_STATE_COOKIE, stateCookie, { ...this.stateCookieOptions(provider), maxAge: OAUTH_STATE_TTL_S * 1000 });
    res.redirect(302, url);
  }

  @Get(':provider/callback')
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'OAuth redirect target: signs in and 302s back to the web app' })
  async callback(
    @Param('provider') name: string,
    @Query('code') code: string | undefined,
    @Query('state') state: string | undefined,
    @Query('error') providerError: string | undefined,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const provider = this.provider(name);
    const stateCookie = (req.cookies as Record<string, unknown> | undefined)?.[OAUTH_STATE_COOKIE];
    res.clearCookie(OAUTH_STATE_COOKIE, this.stateCookieOptions(provider));
    const login = `${this.webUrl}/auth/login`;

    // The user pressed "cancel" at the provider.
    if (providerError) return res.redirect(302, `${login}?oauth_error=cancelled`);

    try {
      const result = await this.oauth.callback(provider, code, state, stateCookie, sessionMetaFrom(req));
      const next = encodeURIComponent(result.next);
      if (result.kind === 'challenge') {
        return res.redirect(302, `${login}?next=${next}#challenge=${encodeURIComponent(result.challenge.challenge)}`);
      }
      setSessionCookies(res, result.tokens, this.cookies);
      return res.redirect(302, `${login}?oauth=success&next=${next}`);
    } catch (err) {
      const code = err instanceof HttpException && /^oauth_[a-z_]+$/.test(err.message) ? err.message.slice(6) : 'failed';
      if (code === 'failed') this.logger.error(`OAuth ${provider} callback failed: ${err instanceof Error ? err.message : String(err)}`);
      return res.redirect(302, `${login}?oauth_error=${code}`);
    }
  }
}
