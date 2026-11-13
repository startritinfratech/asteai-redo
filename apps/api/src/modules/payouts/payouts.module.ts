import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminPayoutsController, PayoutsController } from './payouts.controller';
import { PayoutsService } from './payouts.service';

/** Expert payout accounts and requests, and the admin payout queue. EmailModule is global. */
@Module({
  imports: [LedgerModule, NotificationsModule],
  controllers: [PayoutsController, AdminPayoutsController],
  providers: [PayoutsService],
  exports: [PayoutsService],
})
export class PayoutsModule {}
