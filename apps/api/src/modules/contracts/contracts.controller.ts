import { Body, Controller, Get, Ip, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { ContractsService } from './contracts.service';
import {
  CancelContractDto, CapturePaymentDto, CreateContractDto, DeclineContractDto, ListContractsQueryDto, MilestoneNoteDto,
  SignContractDto,
} from './dto/contract.dto';

/**
 * Contracts and their milestone escrow. Participants (the buyer and the expert) and admins
 * only; the service checks which side the caller is on for every action.
 */
@ApiTags('contracts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('contracts')
export class ContractsController {
  constructor(private readonly svc: ContractsService) {}

  /**
   * STAND-IN until the Razorpay webhook exists: an admin confirms that the payment for
   * escrow request `paymentId` was received (e.g. verified manually) under the provider
   * reference `providerPaymentId`. This is the only way a milestone becomes funded today.
   * The webhook will call ContractsService.markPaymentCaptured directly instead, after
   * verifying the provider's signature; remove this endpoint then.
   */
  @Post('admin/payments/:paymentId/capture')
  @Roles('Admin')
  @ApiOperation({ summary: 'Admin stand-in for the payment webhook: mark an escrow payment captured' })
  capture(
    @Param('paymentId', ParseUUIDPipe) paymentId: string,
    @Body() body: CapturePaymentDto,
    @CurrentUser() user: User,
  ) {
    return this.svc.markPaymentCaptured(body.providerPaymentId, paymentId, `admin:${user.id}`);
  }

  @Get()
  findAll(@Query() query: ListContractsQueryDto, @CurrentUser() user: User) {
    return this.svc.findAll(user, query.status, paginate(query.page, query.pageSize));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findOne(id, user);
  }

  @Post()
  @Roles('Buyer')
  create(@Body() body: CreateContractDto, @CurrentUser() user: User) {
    return this.svc.create(body, user);
  }

  @Post(':id/sign')
  @Roles('Buyer', 'Freelancer')
  sign(@Param('id') id: string, @Body() body: SignContractDto, @Ip() ip: string, @CurrentUser() user: User) {
    return this.svc.sign(id, body.signatureName, ip, user);
  }

  @Post(':id/decline')
  @Roles('Freelancer')
  decline(@Param('id') id: string, @Body() body: DeclineContractDto, @CurrentUser() user: User) {
    return this.svc.decline(id, body.reason, user);
  }

  @Post(':id/cancel')
  @Roles('Buyer', 'Admin')
  cancel(@Param('id') id: string, @Body() body: CancelContractDto, @CurrentUser() user: User) {
    return this.svc.cancel(id, body.reason, user);
  }

  /** Opens a payment request; the milestone is funded only when the payment is captured. */
  @Post(':id/milestones/:mid/fund')
  @Roles('Buyer')
  fund(@Param('id') id: string, @Param('mid', ParseUUIDPipe) mid: string, @CurrentUser() user: User) {
    return this.svc.fundMilestone(id, mid, user);
  }

  @Post(':id/milestones/:mid/submit')
  @Roles('Freelancer')
  submit(
    @Param('id') id: string, @Param('mid', ParseUUIDPipe) mid: string,
    @Body() body: MilestoneNoteDto, @CurrentUser() user: User,
  ) {
    return this.svc.submitMilestone(id, mid, body.note, user);
  }

  @Post(':id/milestones/:mid/request-revision')
  @Roles('Buyer')
  requestRevision(
    @Param('id') id: string, @Param('mid', ParseUUIDPipe) mid: string,
    @Body() body: MilestoneNoteDto, @CurrentUser() user: User,
  ) {
    return this.svc.requestRevision(id, mid, body.note, user);
  }

  @Post(':id/milestones/:mid/accept')
  @Roles('Buyer')
  accept(@Param('id') id: string, @Param('mid', ParseUUIDPipe) mid: string, @CurrentUser() user: User) {
    return this.svc.acceptMilestone(id, mid, user);
  }

  @Post(':id/milestones/:mid/release')
  @Roles('Buyer')
  release(@Param('id') id: string, @Param('mid', ParseUUIDPipe) mid: string, @CurrentUser() user: User) {
    return this.svc.releaseMilestone(id, mid, user);
  }
}
