import { Module } from '@nestjs/common';
import { AdminLeadsController, MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

/** Public website forms: leads, contact / demo, newsletter, careers; plus the admin lead inbox. */
@Module({
  controllers: [MarketingController, AdminLeadsController],
  providers: [MarketingService],
})
export class MarketingModule {}
