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
  CancelContractDto, CreateContractDto, DeclineContractDto, IssueRefundDto, ListContractsQueryDto, MilestoneNoteDto,
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

  /**
   * Admin: refund (part of) the escrow owed back to the buyer of a cancelled contract
   * through Razorpay. Settles when Razorpay confirms (webhook).
   */
  @Post(':id/refund')
  @Roles('Admin')
  @ApiOperation({ summary: 'Refund the escrow due on a cancelled contract through Razorpay' })
  refund(@Param('id') id: string, @Body() body: IssueRefundDto, @CurrentUser() user: User) {
    return this.svc.issueRefund(id, body, user);
  }

  /**
   * Opens a payment request and its Razorpay order, for the web checkout. The milestone is
   * funded only when the payment is captured (POST /payments/razorpay/verify or the webhook).
   */
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

  /** Approve a submitted deliverable and release its escrow to the expert in one step. */
  @Post(':id/milestones/:mid/approve-release')
  @Roles('Buyer')
  approveRelease(@Param('id') id: string, @Param('mid', ParseUUIDPipe) mid: string, @CurrentUser() user: User) {
    return this.svc.approveAndRelease(id, mid, user);
  }
}
