import { Module } from '@nestjs/common';
import { CredentialsModule } from '../credentials/credentials.module';
import { PassportProfilesController } from './passport-profiles.controller';
import { PassportsController } from './passports.controller';
import { PassportsService } from './passports.service';
import { TalentPassportService } from './talent-passport.service';

// Order matters: PassportsController's fixed routes (/me, /verify) must register before
// PassportProfilesController's `/:slug`.
@Module({
  imports: [CredentialsModule],
  controllers: [PassportsController, PassportProfilesController],
  providers: [PassportsService, TalentPassportService],
  exports: [PassportsService, TalentPassportService],
})
export class PassportsModule {}
