import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UpdateShareDto } from './dto/update-share.dto';
import { UpdatePassportProfileDto } from './dto/update-profile.dto';
import { PassportsService } from './passports.service';
import { TalentPassportService } from './talent-passport.service';

@ApiTags('passports')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('passports')
export class PassportsController {
  constructor(private readonly svc: PassportsService, private readonly talent: TalentPassportService) {}

  @Get('me')
  myPassports(@CurrentUser() user: User) {
    return this.svc.findForUser(user.id);
  }

  /** The caller's Verified Talent Passport (created, private, on first visit). */
  @Get('me/profile')
  myProfile(@CurrentUser() user: User) {
    return this.talent.getMine(user.id);
  }

  @Patch('me/profile')
  updateProfile(@CurrentUser() user: User, @Body() dto: UpdatePassportProfileDto) {
    return this.talent.updateMine(user.id, dto);
  }

  /** Signs a snapshot of the passport as it stands; share the returned /verify code. */
  @Post('me/credentials')
  issueSnapshot(@CurrentUser() user: User) {
    return this.talent.issueSnapshot(user.id);
  }

  @Get('verify')
  verify(@Query('hash') hash: string) {
    return this.svc.verify(hash);
  }

  @Patch(':id/share')
  updateShare(@Param('id') id: string, @Body() body: UpdateShareDto, @CurrentUser() user: User) {
    return this.svc.updateShare(id, body, user);
  }

  @Post(':id/verify')
  @Roles('Employer', 'Buyer', 'Admin')
  addVerification(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.addVerification(id, user);
  }
}
