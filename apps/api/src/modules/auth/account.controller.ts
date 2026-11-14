import {
  Body, Controller, Delete, Get, HttpCode, HttpStatus, Logger, Param, ParseUUIDPipe, Post, Req, UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountSecurityService } from './account-security.service';
import { sessionMetaFrom } from './auth.service';
import { TwoFactorService } from './two-factor.service';
import { SessionCookieInterceptor } from './session-cookie.interceptor';
import {
  ChangePasswordDto, DisableTwoFactorDto, ForgotPasswordDto, ResetPasswordDto, TwoFactorCodeDto, TwoFactorLoginDto,
  VerifyEmailDto,
} from './dto/account-security.dto';

const jwt = AuthGuard('jwt');

/** Password reset/change, email verification, two-factor authentication and sessions. */
@ApiTags('auth')
@Controller('auth')
@UseInterceptors(SessionCookieInterceptor)
export class AccountController {
  private readonly logger = new Logger(AccountController.name);

  constructor(
    private readonly security: AccountSecurityService,
    private readonly twoFactor: TwoFactorService,
  ) {}

  // ── Password ─────────────────────────────────────────────────────────────────

  /** Always 204, immediately: the answer never depends on whether the account exists. */
  @Post('password/forgot')
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Email a password reset link, if the account exists' })
  forgotPassword(@Body() dto: ForgotPasswordDto): void {
    this.security.forgotPassword(dto.email).catch((err: unknown) => {
      this.logger.error(`Password reset request failed: ${err instanceof Error ? err.message : String(err)}`);
    });
  }

  @Post('password/reset')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Set a new password with a reset link token; signs out every session' })
  async resetPassword(@Body() dto: ResetPasswordDto): Promise<void> {
    await this.security.resetPassword(dto.token, dto.password);
  }

  @Post('password/change')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Change the password; signs out other sessions and returns new tokens' })
  changePassword(@CurrentUser() user: User, @Body() dto: ChangePasswordDto, @Req() req: Request) {
    return this.security.changePassword(user, dto.currentPassword, dto.newPassword, sessionMetaFrom(req));
  }

  // ── Email verification ───────────────────────────────────────────────────────

  @Post('verify-email/send')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 3 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Email a new verification link (no-op when already verified)' })
  async sendVerification(@CurrentUser() user: User): Promise<void> {
    await this.security.sendVerification(user);
  }

  @Post('verify-email')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Confirm the email address with a verification link token' })
  async verifyEmail(@Body() dto: VerifyEmailDto): Promise<void> {
    await this.security.verifyEmail(dto.token);
  }

  // ── Two-factor authentication ────────────────────────────────────────────────

  @Post('login/2fa')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Second sign-in step: the challenge from /auth/login plus a code or backup code' })
  loginTwoFactor(@Body() dto: TwoFactorLoginDto, @Req() req: Request) {
    return this.twoFactor.completeLogin(dto.challenge, { code: dto.code, backupCode: dto.backupCode }, sessionMetaFrom(req));
  }

  @Get('2fa')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Two-factor status and remaining backup codes' })
  twoFactorStatus(@CurrentUser() user: User) {
    return this.twoFactor.status(user.id);
  }

  @Post('2fa/setup')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Start enrolment: a new TOTP secret and otpauth:// URI' })
  setupTwoFactor(@CurrentUser() user: User) {
    return this.twoFactor.setup(user);
  }

  @Post('2fa/enable')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Finish enrolment with a code; returns 10 one-time backup codes, once' })
  enableTwoFactor(@CurrentUser() user: User, @Body() dto: TwoFactorCodeDto) {
    return this.twoFactor.enable(user, dto.code);
  }

  @Post('2fa/disable')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Turn two-factor authentication off (password plus a code or backup code)' })
  async disableTwoFactor(@CurrentUser() user: User, @Body() dto: DisableTwoFactorDto): Promise<void> {
    await this.twoFactor.disable(user, dto.password, { code: dto.code, backupCode: dto.backupCode });
  }

  // ── Sessions ─────────────────────────────────────────────────────────────────

  @Get('sessions')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Signed-in devices (active refresh tokens)' })
  sessions(@CurrentUser() user: User) {
    return this.security.listSessions(user.id);
  }

  @Delete('sessions/:id')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Sign one device out' })
  async revokeSession(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string): Promise<void> {
    await this.security.revokeSession(user.id, id);
  }
}
