import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { AssessmentsService } from './assessments.service';
import {
  AnswerAssessmentDto, ListSessionsQueryDto, ResetSessionDto, ResolveIntegrityDto, StartAssessmentDto,
} from './dto/assessment.dto';

@ApiTags('assessments')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('assessments')
export class AssessmentsController {
  constructor(private readonly svc: AssessmentsService) {}

  /** Starts (or resumes) the role-fit assessment for one of the candidate's applications. */
  @Post('sessions')
  @Roles('Candidate')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  start(@Body() body: StartAssessmentDto, @CurrentUser() user: User) {
    return this.svc.start(user, body.requisitionId);
  }

  @Get('sessions/:id')
  @Roles('Candidate')
  current(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.current(user, id);
  }

  @Post('sessions/:id/answer')
  @Roles('Candidate')
  @HttpCode(200)
  answer(@Param('id') id: string, @Body() body: AnswerAssessmentDto, @CurrentUser() user: User) {
    return this.svc.answer(user, id, body);
  }

  @Get('admin/sessions')
  @Roles('Admin')
  listSessions(@Query() query: ListSessionsQueryDto) {
    return this.svc.listSessions(query.status, query.limit);
  }

  /** Lets a candidate start again after an expired or stuck session. Audited. */
  @Post('admin/sessions/:id/reset')
  @Roles('Admin')
  @HttpCode(200)
  resetSession(@Param('id') id: string, @Body() body: ResetSessionDto, @CurrentUser() user: User) {
    return this.svc.resetSession(user, id, body.reason);
  }

  @Get('result/:id')
  findResult(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findResult(id, user);
  }

  @Get('integrity-queue')
  @Roles('Admin', 'Employer')
  integrityQueue(@CurrentUser() user: User) {
    return this.svc.getIntegrityQueue(user);
  }

  @Patch('integrity-queue/:id/resolve')
  @Roles('Admin', 'Employer')
  resolve(@Param('id') id: string, @Body() body: ResolveIntegrityDto, @CurrentUser() user: User) {
    return this.svc.resolveIntegrity(id, body.resolution, user);
  }
}
