import {
  Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import {
  AdminExpertsQueryDto, CreateReviewDto, ListExpertsQueryDto, SetExpertStatusDto,
} from './dto/profile.dto';
import { ExpertsService } from './experts.service';
import { ProfilesService } from './profiles.service';
import { ReviewsService } from './reviews.service';

@ApiTags('profiles')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('profiles')
export class ProfilesController {
  constructor(private readonly svc: ProfilesService) {}

  @Get('me')
  @Roles('Freelancer', 'Buyer')
  mine(@CurrentUser() user: User) {
    return this.svc.getMine(user);
  }

  /**
   * Freelancer body: ExpertProfileDto; Buyer body: BuyerProfileDto. The body is typed
   * loosely here (so the global pipe skips it) and validated per role in the service.
   */
  @Put('me')
  @Roles('Freelancer', 'Buyer')
  @ApiBody({ schema: { type: 'object' } })
  update(@Body() body: Record<string, unknown>, @CurrentUser() user: User) {
    return this.svc.updateMine(user, body);
  }

  @Post('me/submit')
  @Roles('Freelancer')
  @HttpCode(200)
  submit(@CurrentUser() user: User) {
    return this.svc.submit(user);
  }
}

/** The public expert directory. No sign-in needed; a token only widens what the owner / admins see. */
@ApiTags('experts')
@Controller('experts')
export class ExpertsController {
  constructor(private readonly svc: ExpertsService) {}

  @Get()
  @Throttle({ short: { ttl: 60_000, limit: 120 } })
  list(@Query() query: ListExpertsQueryDto) {
    return this.svc.list(query);
  }

  @Get(':userId')
  @UseGuards(OptionalJwtGuard)
  detail(@Param('userId', new ParseUUIDPipe()) userId: string, @CurrentUser() user: User | null) {
    return this.svc.detail(userId, user ?? null);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('admin/experts')
export class AdminExpertsController {
  constructor(private readonly svc: ExpertsService) {}

  @Get()
  queue(@Query() query: AdminExpertsQueryDto) {
    return this.svc.adminList(query);
  }

  @Patch(':userId/status')
  setStatus(
    @Param('userId', new ParseUUIDPipe()) userId: string,
    @Body() body: SetExpertStatusDto,
    @CurrentUser() admin: User,
  ) {
    return this.svc.setStatus(admin, userId, body);
  }
}

@ApiTags('reviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly svc: ReviewsService) {}

  @Post()
  @Roles('Buyer', 'Freelancer')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  create(@Body() body: CreateReviewDto, @CurrentUser() user: User) {
    return this.svc.create(user, body);
  }
}
