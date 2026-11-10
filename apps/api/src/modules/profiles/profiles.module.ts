import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import {
  AdminExpertsController, ExpertsController, ProfilesController, ReviewsController,
} from './profiles.controller';
import { ExpertsService } from './experts.service';
import { ProfilesService } from './profiles.service';
import { ReviewsService } from './reviews.service';

/** Freelancer / buyer profiles, the public expert directory, admin approvals and reviews. */
@Module({
  imports: [NotificationsModule],
  controllers: [ProfilesController, ExpertsController, AdminExpertsController, ReviewsController],
  providers: [ProfilesService, ExpertsService, ReviewsService],
  exports: [ProfilesService, ExpertsService],
})
export class ProfilesModule {}
