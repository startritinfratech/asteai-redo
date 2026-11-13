import { Module } from '@nestjs/common';
import { PublicController } from './public.controller';
import { PublicService } from './public.service';

/** Read-only, signed-out data: job board, pricing plans, credit settings, stats, geo. */
@Module({
  controllers: [PublicController],
  providers: [PublicService],
})
export class PublicModule {}
