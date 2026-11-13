import {
  Body, Controller, HttpCode, HttpStatus, Post, Req, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
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

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly auth: AuthService,
    private readonly twoFactor: TwoFactorService,
    private readonly signupOtp: SignupOtpService,
  ) {}

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

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Exchange a refresh token for new tokens' })
  async refresh(@Body() body: RefreshTokenDto) {
    return this.auth.refreshTokens(body.userId, body.refreshToken);
  }

  /**
   * With a valid bearer token: revokes all of the user's refresh tokens. Without one
   * (the access token expired), `{ userId, refreshToken }` revokes that refresh token.
   */
  @Post('logout')
  @UseGuards(OptionalJwtGuard)
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Revoke the refresh tokens of the current user, or the one given' })
  async logout(@CurrentUser() user: User | null, @Body() body: LogoutDto) {
    if (user) {
      await this.auth.logout(user.id);
      return;
    }
    if (!body.userId || !body.refreshToken) throw new UnauthorizedException();
    await this.auth.revokeRefreshToken(body.userId, body.refreshToken);
  }
}
