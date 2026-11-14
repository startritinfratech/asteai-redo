import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { map, type Observable } from 'rxjs';
import { cookieSettings, isAuthTokens, setSessionCookies, type CookieSettings } from './session-cookies';

/**
 * On auth controllers: any handler that returns tokens (login, register, refresh, 2FA
 * login, password change) has them moved into HttpOnly cookies, and the body becomes
 * `{ user, sessionId }`. Other responses (a 2FA challenge, 204s) pass through untouched.
 */
@Injectable()
export class SessionCookieInterceptor implements NestInterceptor {
  private readonly settings: CookieSettings;

  constructor(config: ConfigService) {
    this.settings = cookieSettings(config);
  }

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const res = ctx.switchToHttp().getResponse<Response>();
    return next.handle().pipe(
      map((body: unknown) => (isAuthTokens(body) ? setSessionCookies(res, body, this.settings) : body)),
    );
  }
}
