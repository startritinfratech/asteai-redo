import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { PaymentsService } from './payments.service';

/** Admin: payments Razorpay received that could not be applied, and their full refund. */
@ApiTags('payments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('payments/unapplied')
export class PaymentsAdminController {
  constructor(private readonly svc: PaymentsService) {}

  @Get()
  @ApiOperation({ summary: 'Payments received but not applied (admin)' })
  list() {
    return this.svc.listUnapplied();
  }

  @Post(':orderId/refund')
  @HttpCode(200)
  @ApiOperation({ summary: 'Refund an unapplied payment in full, once (admin)' })
  refund(@Param('orderId', ParseUUIDPipe) orderId: string, @CurrentUser() user: User) {
    return this.svc.refundUnapplied(orderId, user);
  }
}
