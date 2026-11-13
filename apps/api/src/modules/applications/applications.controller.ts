import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User } from '@asteai/types';
import { AddScorecardDto, AdvanceStageDto } from './dto/application.dto';

@ApiTags('applications')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly svc: ApplicationsService) {}

  @Get('requisition/:reqId')
  @Roles('Employer', 'Admin')
  forRequisition(@Param('reqId') reqId: string, @CurrentUser() user: User) {
    return this.svc.findForRequisition(reqId, user);
  }

  @Get('candidate/:candidateId')
  @Roles('Candidate', 'Employer', 'Admin')
  forCandidate(@Param('candidateId') id: string, @CurrentUser() user: User) {
    return this.svc.findForCandidate(id, user);
  }

  @Get('me')
  @Roles('Candidate')
  myApplications(@CurrentUser() user: User) {
    return this.svc.findForCandidate(user.id, user);
  }

  @Post(':reqId/apply')
  @Roles('Candidate')
  apply(@Param('reqId') reqId: string, @CurrentUser() user: User) {
    return this.svc.apply(reqId, user.id);
  }

  @Patch(':id/stage')
  @Roles('Employer', 'Admin')
  advanceStage(
    @Param('id') id: string,
    @Body() body: AdvanceStageDto,
    @CurrentUser() user: User,
  ) {
    const by = body.by ?? `${user.firstName} ${user.lastName}`.trim();
    return this.svc.advanceStage(id, body.stage, by, user);
  }

  @Post(':id/scorecards')
  @Roles('Employer', 'Admin')
  addScorecard(
    @Param('id') id: string,
    @Body() body: AddScorecardDto,
    @CurrentUser() user: User,
  ) {
    return this.svc.addScorecard(id, body, user);
  }
}
