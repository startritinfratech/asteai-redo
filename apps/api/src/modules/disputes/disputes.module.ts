import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { DisputeSweepService } from './dispute-sweep.service';
import { DisputesController, MilestoneDisputesController } from './disputes.controller';
import { DisputesService } from './disputes.service';

/** Contract disputes, their message threads, admin resolution and the SLA sweep. */
@Module({
  imports: [ContractsModule, NotificationsModule],
  controllers: [DisputesController, MilestoneDisputesController],
  providers: [DisputesService, DisputeSweepService],
})
export class DisputesModule {}
