import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import {
  CareerApplicationDto, ContactDto, LeadDto, LeadsQueryDto, NewsletterDto, SetLeadStatusDto, TokenDto,
} from './dto/marketing.dto';
import { MarketingService, type RequestContext } from './marketing.service';

const ctx = (req: Request): RequestContext => ({
  ip: req.ip ?? null,
  userAgent: typeof req.headers['user-agent'] === 'string' ? req.headers['user-agent'] : null,
});

/** Public form limit: 5 per minute per client, on top of the global limits. */
const FORM_LIMIT = { short: { ttl: 60_000, limit: 5 } };

@ApiTags('public-forms')
@Controller()
export class MarketingController {
  constructor(private readonly svc: MarketingService) {}

  @Post('leads')
  @Throttle(FORM_LIMIT)
  @ApiOperation({ summary: 'Submit a hiring requirement (landing-page lead form)' })
  submitLead(@Body() dto: LeadDto, @Req() req: Request) {
    return this.svc.submitLead(dto, ctx(req));
  }

  @Post('contact')
  @Throttle(FORM_LIMIT)
  @ApiOperation({ summary: 'Contact or demo request' })
  submitContact(@Body() dto: ContactDto, @Req() req: Request) {
    return this.svc.submitContact(dto, ctx(req));
  }

  @Post('newsletter/subscribe')
  @Throttle(FORM_LIMIT)
  @ApiOperation({ summary: 'Newsletter sign-up (double opt-in; always answers pending)' })
  subscribe(@Body() dto: NewsletterDto, @Req() req: Request) {
    return this.svc.subscribe(dto, ctx(req));
  }

  @Post('newsletter/confirm')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Confirm a newsletter subscription with the emailed token' })
  confirm(@Body() dto: TokenDto) {
    return this.svc.confirmSubscription(dto.token);
  }

  @Post('newsletter/unsubscribe')
  @HttpCode(HttpStatus.OK)
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Unsubscribe with the token from any newsletter email' })
  unsubscribe(@Body() dto: TokenDto) {
    return this.svc.unsubscribe(dto.token);
  }

  @Get('careers/roles')
  @ApiOperation({ summary: 'Open roles at ASTEAI' })
  careerRoles() {
    return this.svc.careerRoles();
  }

  @Post('careers/applications')
  @Throttle({ short: { ttl: 60_000, limit: 3 } })
  @ApiOperation({ summary: 'Apply for an open role at ASTEAI' })
  apply(@Body() dto: CareerApplicationDto, @Req() req: Request) {
    return this.svc.applyForRole(dto, ctx(req));
  }
}

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('admin/leads')
export class AdminLeadsController {
  constructor(private readonly svc: MarketingService) {}

  @Get()
  list(@Query() q: LeadsQueryDto) {
    return this.svc.listLeads(q.status, paginate(q.page, q.pageSize));
  }

  @Patch(':id')
  setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetLeadStatusDto, @CurrentUser() user: User) {
    return this.svc.setLeadStatus(id, dto.status, user.id);
  }
}
