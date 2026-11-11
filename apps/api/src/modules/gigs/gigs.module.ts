import { Module } from '@nestjs/common';
import { ContractsModule } from '../contracts/contracts.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AdminServicesController, GigOrdersController, ServicesController } from './gigs.controller';
import { GigOrdersService } from './gig-orders.service';
import { GigSweepService } from './gig-sweep.service';
import { ServicesService } from './services.service';

/** Pre-packaged services (gigs): listings, the admin approval queue and orders (which run on contracts). */
@Module({
  imports: [NotificationsModule, ContractsModule],
  controllers: [ServicesController, AdminServicesController, GigOrdersController],
  providers: [ServicesService, GigOrdersService, GigSweepService],
})
export class GigsModule {}
