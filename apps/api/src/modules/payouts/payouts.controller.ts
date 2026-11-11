import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Put, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { ListPayoutsQueryDto, MarkPaidDto, PayoutAccountDto, RejectPayoutDto, RequestPayoutDto } from './dto/payout.dto';
import { PayoutsService } from './payouts.service';

/** The expert's own payout account and payout requests. */
@ApiTags('payouts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Freelancer')
@Controller('payouts')
export class PayoutsController {
  constructor(private readonly svc: PayoutsService) {}

  @Get('account')
  account(@CurrentUser() user: User) {
    return this.svc.getAccount(user.id);
  }

  @Put('account')
  saveAccount(@CurrentUser() user: User, @Body() body: PayoutAccountDto) {
    return this.svc.saveAccount(user, body);
  }

  @Get()
  mine(@CurrentUser() user: User) {
    return this.svc.overview(user.id);
  }

  @Post()
  request(@CurrentUser() user: User, @Body() body: RequestPayoutDto) {
    return this.svc.request(user, body.amount);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.cancel(user, id);
  }
}

/**
 * The admin payout queue. The transfer itself happens outside the app (RazorpayX is not
 * wired): the admin pays, then records the bank reference with mark-paid.
 */
@ApiTags('payouts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('admin/payouts')
export class AdminPayoutsController {
  constructor(private readonly svc: PayoutsService) {}

  @Get()
  list(@Query() query: ListPayoutsQueryDto) {
    return this.svc.listForAdmin(query.status, paginate(query.page, query.pageSize, 50));
  }

  @Get(':id/details')
  @ApiOperation({ summary: 'Unmasked bank / UPI details of a request (audited)' })
  details(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.destination(admin, id);
  }

  @Post(':id/approve')
  approve(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string) {
    return this.svc.approve(admin, id);
  }

  @Post(':id/mark-paid')
  markPaid(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: MarkPaidDto) {
    return this.svc.markPaid(admin, id, body.reference);
  }

  @Post(':id/reject')
  reject(@CurrentUser() admin: User, @Param('id', ParseUUIDPipe) id: string, @Body() body: RejectPayoutDto) {
    return this.svc.reject(admin, id, body.note);
  }
}
