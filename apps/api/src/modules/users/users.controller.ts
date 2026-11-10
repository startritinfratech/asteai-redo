import { Controller, Get, Put, Post, Delete, Body, HttpCode, HttpStatus, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { UsersService } from './users.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { User } from '@asteai/types';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ToggleConsentDto } from './dto/toggle-consent.dto';
import { DeleteAccountDto } from './dto/delete-account.dto';

@ApiTags('users')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('users')
export class UsersController {
  constructor(private readonly svc: UsersService) {}

  @Get('me')
  getMe(@CurrentUser() user: User) {
    return this.svc.findById(user.id);
  }

  @Put('me')
  updateMe(@CurrentUser() user: User, @Body() body: UpdateProfileDto) {
    return this.svc.updateProfile(user.id, body);
  }

  @Get('me/consents')
  getConsents(@CurrentUser() user: User) {
    return this.svc.getConsents(user.id);
  }

  @Post('me/consents')
  toggleConsent(@CurrentUser() user: User, @Body() body: ToggleConsentDto) {
    return this.svc.toggleConsent(user.id, body.purpose, body.active);
  }

  /**
   * Soft-deletes the account after checking the password: marks it deleted, anonymises the
   * email (so the address can sign up again) and signs out every session.
   */
  @Delete('me')
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async deleteMe(@CurrentUser() user: User, @Body() body: DeleteAccountDto): Promise<void> {
    await this.svc.deleteAccount(user.id, body.password);
  }

  @Post('me/export')
  exportData(@CurrentUser() user: User) {
    return this.svc.exportData(user.id);
  }
}
