import { Controller, Get, NotFoundException, Param, UnauthorizedException, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { PassportsService } from './passports.service';
import { TalentPassportService } from './talent-passport.service';

const LEGACY_ID = /^PASS-[0-9A-Z]{4,16}$/;

/**
 * Public passport reads. Registered after PassportsController, so its fixed routes
 * (/passports/me, /passports/verify) win over `:slug`.
 */
@ApiTags('passports')
@UseGuards(OptionalJwtGuard)
@Controller('passports')
export class PassportProfilesController {
  constructor(private readonly talent: TalentPassportService, private readonly legacy: PassportsService) {}

  /** Each competency with how the whole platform scores on it (mean, median, p90). */
  @Get('benchmarks')
  @ApiOperation({ summary: 'Competency benchmarks across all passports' })
  benchmarks() {
    return this.talent.benchmarks();
  }

  /**
   * `/passports/<slug>`: the Verified Talent Passport (public ones to anyone; private
   * ones to the holder and admins). `/passports/PASS-…` is the older assessment passport
   * record, for signed-in users as before.
   */
  @Get(':slug')
  @ApiOperation({ summary: 'A Verified Talent Passport by its public address' })
  bySlug(@Param('slug') slug: string, @CurrentUser() user: User | null) {
    if (LEGACY_ID.test(slug)) {
      if (!user) throw new UnauthorizedException();
      return this.legacy.findById(slug, user);
    }
    if (slug.length > 40) throw new NotFoundException('Passport not found');
    return this.talent.bySlug(slug, user);
  }
}
