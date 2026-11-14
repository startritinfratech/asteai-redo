import { Module } from '@nestjs/common';
import { AdminRequisitionsController, RequisitionsController } from './requisitions.controller';
import { RequisitionsService } from './requisitions.service';

@Module({
  controllers: [RequisitionsController, AdminRequisitionsController],
  providers:   [RequisitionsService],
  exports:     [RequisitionsService],
})
export class RequisitionsModule {}
