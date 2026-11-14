import {
  Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards, UseInterceptors,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { Throttle } from '@nestjs/throttler';
import { AuthService, sessionMetaFrom } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { LogoutDto } from './dto/logout.dto';
import { SendOtpDto, VerifyOtpDto } from './dto/signup-otp.dto';
import { SignupOtpService } from './signup-otp.service';
import { OptionalJwtGuard } from './optional-jwt.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '@asteai/types';
import { SessionCookieInterceptor } from './session-cookie.interceptor';
import { clearSessionCookies, cookieSettings, readRefreshCookie, type CookieSettings } from './session-cookies';

@ApiTags('auth')
@Controller('auth')
@UseInterceptors(SessionCookieInterceptor)
export class AuthController {
  private readonly cookies: CookieSettings;

  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly signupOtp: SignupOtpService,
    config: ConfigService,
  ) {
    this.cookies = cookieSettings(config);
  }

  @Post('register')
  @ApiOperation({ summary: 'Register a new user account' })
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  async register(@Body() dto: RegisterDto, @Req() req: Request) {
    return this.auth.register(dto, sessionMetaFrom(req));
  }

  @Post('email/send-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Email a 6-digit sign-up code (same answer whether or not the address is registered)' })
  sendOtp(@Body() dto: SendOtpDto, @Req() req: Request) {
    return this.signupOtp.send(dto.email, dto, req.ip ?? null);
  }

  @Post('email/verify-otp')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Check a sign-up code; returns the otpTicket POST /auth/register accepts' })
  verifyOtp(@Body() dto: VerifyOtpDto) {
    return this.signupOtp.verify(dto.email, dto.code);
  }

  @Post('login')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @UseGuards(AuthGuard('local'))
  @ApiBody({ type: LoginDto })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Login with email + password',
    description: 'Returns tokens, or `{ twoFactorRequired: true, challenge }` when two-factor authentication is on (then POST /auth/login/2fa).',
  })
  async login(@Req() req: Request & { user: User }) {
    return this.twoFactor.startLogin(req.user, sessionMetaFrom(req));
  }

  /** The refresh cookie (browsers) or `{ userId, refreshToken }` (other clients). */
  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rotate the session: new access + refresh cookies' })
  async refresh(@Body() body: RefreshTokenDto, @Req() req: Request) {
    const creds = body.userId && body.refreshToken
      ? { userId: body.userId, refreshToken: body.refreshToken }
      : readRefreshCookie(req);
    if (!creds) throw new UnauthorizedException('Invalid or expired refresh token');
    return this.auth.refreshTokens(creds.userId, creds.refreshToken);
  }

  /**
   * Always 204 and always clears the session cookies. With a valid access token every
   * refresh token of the user is revoked (as before); otherwise only the refresh token
   * from the cookie (or body). Idempotent: unknown or already revoked tokens are ignored.
   */
  @Post('logout')
  @UseGuards(OptionalJwtGuard)
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign out: revoke the session and clear its cookies' })
  async logout(
    @CurrentUser() user: User | null,
    @Body() body: LogoutDto,
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
  ): Promise<void> {
    try {
      if (user) {
        await this.auth.logout(user.id);
        return;
      }
      const creds = body.userId && body.refreshToken
        ? { userId: body.userId, refreshToken: body.refreshToken }
        : readRefreshCookie(req);
      if (creds) await this.auth.revokeRefreshToken(creds.userId, creds.refreshToken);
    } finally {
      clearSessionCookies(res, this.cookies);
    }
  }
}
