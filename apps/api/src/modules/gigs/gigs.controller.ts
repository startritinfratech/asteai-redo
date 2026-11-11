import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import {
  AdminServicesQueryDto, CreateOrderDto, DeliverDto, ListOrdersQueryDto, ListServicesQueryDto, OrderReviewDto,
  PackagesDto, RevisionDto, ServiceDto, SetServiceStatusDto,
} from './dto/gig.dto';
import { GigOrdersService } from './gig-orders.service';
import { ServicesService } from './services.service';

const AUTH = [AuthGuard('jwt'), RolesGuard] as const;

/**
 * /services: the public catalogue (no sign-in; a token only lets the owner / admins open an
 * unpublished listing) and the expert's own lifecycle. `mine` is declared before `:slug`.
 */
@ApiTags('services')
@Controller('services')
export class ServicesController {
  constructor(private readonly svc: ServicesService) {}

  @Get()
  @Throttle({ short: { ttl: 60_000, limit: 120 } })
  list(@Query() query: ListServicesQueryDto) {
    return this.svc.list(query);
  }

  @Get('mine')
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  mine(@CurrentUser() user: User) {
    return this.svc.mine(user);
  }

  @Get(':slug')
  @UseGuards(OptionalJwtGuard)
  detail(@Param('slug') slug: string, @CurrentUser() user: User | null) {
    return this.svc.detail(slug, user ?? null);
  }

  @Post()
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  create(@Body() body: ServiceDto, @CurrentUser() user: User) {
    return this.svc.create(body, user);
  }

  @Put(':id')
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  update(@Param('id') id: string, @Body() body: ServiceDto, @CurrentUser() user: User) {
    return this.svc.update(id, body, user);
  }

  @Post(':id/packages')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  packages(@Param('id') id: string, @Body() body: PackagesDto, @CurrentUser() user: User) {
    return this.svc.setPackages(id, body, user);
  }

  @Post(':id/submit')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  submit(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.submit(id, user);
  }

  @Post(':id/pause')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  pause(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.pause(id, user);
  }

  @Post(':id/resume')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(...AUTH)
  @Roles('Freelancer')
  resume(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.resume(id, user);
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(...AUTH)
@Roles('Admin')
@Controller('admin/services')
export class AdminServicesController {
  constructor(private readonly svc: ServicesService) {}

  @Get()
  queue(@Query() query: AdminServicesQueryDto) {
    return this.svc.adminList(query);
  }

  @Patch(':id/status')
  setStatus(@Param('id') id: string, @Body() body: SetServiceStatusDto, @CurrentUser() admin: User) {
    return this.svc.setStatus(id, body, admin);
  }
}

/** Gig orders: a contract underneath, so paying, releasing, disputing and refunding use /contracts. */
@ApiTags('orders')
@ApiBearerAuth()
@UseGuards(...AUTH)
@Controller('orders')
export class GigOrdersController {
  constructor(private readonly svc: GigOrdersService) {}

  @Get()
  @Roles('Buyer', 'Freelancer', 'Admin')
  findAll(@Query() query: ListOrdersQueryDto, @CurrentUser() user: User) {
    return this.svc.findAll(user, query, paginate(query.page, query.pageSize));
  }

  @Get(':id')
  @Roles('Buyer', 'Freelancer', 'Admin')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findOne(id, user);
  }

  @Post()
  @Roles('Buyer')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  create(@Body() body: CreateOrderDto, @CurrentUser() user: User) {
    return this.svc.create(body, user);
  }

  @Post(':id/deliver')
  @HttpCode(200)
  @Roles('Freelancer')
  deliver(@Param('id') id: string, @Body() body: DeliverDto, @CurrentUser() user: User) {
    return this.svc.deliver(id, body, user);
  }

  @Post(':id/request-revision')
  @HttpCode(200)
  @Roles('Buyer')
  requestRevision(@Param('id') id: string, @Body() body: RevisionDto, @CurrentUser() user: User) {
    return this.svc.requestRevision(id, body, user);
  }

  @Post(':id/accept')
  @HttpCode(200)
  @Roles('Buyer')
  accept(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.accept(id, user);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @Roles('Buyer')
  cancel(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.cancel(id, user);
  }

  @Post(':id/review')
  @Roles('Buyer')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  review(@Param('id') id: string, @Body() body: OrderReviewDto, @CurrentUser() user: User) {
    return this.svc.review(id, body, user);
  }
}
