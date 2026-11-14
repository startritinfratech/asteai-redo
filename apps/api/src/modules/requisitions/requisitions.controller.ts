import {
  Controller, Delete, Get, HttpCode, Post, Put, Patch, Body, Param, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth, ApiOperation } from '@nestjs/swagger';
import { RequisitionsService } from './requisitions.service';
import { CreateRequisitionDto } from './dto/create-requisition.dto';
import { ReviewRequisitionDto, UpdateRequisitionDto } from './dto/update-requisition.dto';
import { RequisitionPostingDto } from './dto/posting.dto';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { REQ_APPROVAL_STATUSES, REQ_STATUSES, type ReqApprovalStatus, type ReqStatus, type User } from '@asteai/types';
import { paginate } from '../../common/utils/pagination';

@ApiTags('requisitions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('requisitions')
export class RequisitionsController {
  constructor(private readonly svc: RequisitionsService) {}

  @Get()
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'List requisitions (scoped to tenant)' })
  findAll(
    @CurrentUser() user: User,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    const validStatus = REQ_STATUSES.includes(status as ReqStatus) ? (status as ReqStatus) : undefined;
    return this.svc.findAll(user, { status: validStatus, ...paginate(page, pageSize) });
  }

  @Get(':id')
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Get a single requisition' })
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findOne(id, user);
  }

  @Post()
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Create a requisition' })
  create(@Body() dto: CreateRequisitionDto, @CurrentUser() user: User) {
    return this.svc.create(dto, user);
  }

  @Put(':id')
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Update a requisition' })
  update(
    @Param('id') id: string,
    @Body() dto: UpdateRequisitionDto,
    @CurrentUser() user: User,
  ) {
    return this.svc.update(id, dto, user);
  }

  @Patch(':id/posting')
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Publish to / hide from the public job board and set its pay, type and expiry' })
  updatePosting(@Param('id') id: string, @Body() dto: RequisitionPostingDto, @CurrentUser() user: User) {
    return this.svc.updatePosting(id, dto, user);
  }

  @Post(':id/submit-for-approval')
  @HttpCode(200)
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Ask an admin to approve the requisition for the public job board' })
  submitForApproval(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.submitForApproval(id, user);
  }

  @Delete(':id')
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Delete a requisition with no applications (otherwise close it)' })
  remove(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.remove(id, user);
  }

  @Patch(':id/fund')
  @Roles('Employer', 'Admin')
  @ApiOperation({ summary: 'Fund SLA and activate a requisition' })
  fund(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.fundSla(id, user);
  }
}

/** Admin review of requisitions before they can be listed publicly. */
@ApiTags('requisitions')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('admin/requisitions')
export class AdminRequisitionsController {
  constructor(private readonly svc: RequisitionsService) {}

  @Get('approvals')
  @ApiOperation({ summary: 'Approval queue (default: pending, oldest first)' })
  queue(@Query('status') status?: string, @Query('page') page?: string) {
    const s = (REQ_APPROVAL_STATUSES as readonly string[]).includes(status ?? '') ? (status as ReqApprovalStatus) : 'pending';
    return this.svc.approvalQueue(s, paginate(page, 50, 50, 100));
  }

  @Post(':id/approve')
  @HttpCode(200)
  approve(@Param('id') id: string, @Body() dto: ReviewRequisitionDto, @CurrentUser() user: User) {
    return this.svc.review(id, user, 'approved', dto.note);
  }

  @Post(':id/reject')
  @HttpCode(200)
  reject(@Param('id') id: string, @Body() dto: ReviewRequisitionDto, @CurrentUser() user: User) {
    return this.svc.review(id, user, 'rejected', dto.note);
  }
}
