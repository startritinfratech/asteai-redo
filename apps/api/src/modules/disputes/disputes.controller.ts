import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import { DisputesService } from './disputes.service';
import { CreateDisputeDto, DisputeMessageDto, ListDisputesQueryDto, ResolveDisputeDto } from './dto/dispute.dto';

/**
 * Disputes on contracts. The two parties of the contract and admins only; the service
 * checks which side the caller is on for every action.
 */
@ApiTags('disputes')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('disputes')
export class DisputesController {
  constructor(private readonly svc: DisputesService) {}

  /** The caller's disputes; admins: all (the review queue), optionally by status. */
  @Get()
  findAll(@Query() query: ListDisputesQueryDto, @CurrentUser() user: User) {
    return this.svc.findAll(user, query.status, paginate(query.page, query.pageSize));
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findOne(id, user);
  }

  @Post()
  @Roles('Buyer', 'Freelancer')
  @ApiOperation({ summary: 'Raise a dispute on a contract (or one of its funded milestones); freezes the contract' })
  create(@Body() body: CreateDisputeDto, @CurrentUser() user: User) {
    return this.svc.create(body, user);
  }

  @Post(':id/messages')
  @Roles('Buyer', 'Freelancer', 'Admin')
  addMessage(@Param('id') id: string, @Body() body: DisputeMessageDto, @CurrentUser() user: User) {
    return this.svc.addMessage(id, body, user);
  }

  @Post(':id/withdraw')
  @Roles('Buyer', 'Freelancer')
  withdraw(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.withdraw(id, user);
  }

  @Post(':id/resolve')
  @Roles('Admin')
  @ApiOperation({ summary: 'Resolve a dispute: release, refund, split or no action' })
  resolve(@Param('id') id: string, @Body() body: ResolveDisputeDto, @CurrentUser() user: User) {
    return this.svc.resolve(id, body, user);
  }
}
