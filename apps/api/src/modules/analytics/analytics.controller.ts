import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AnalyticsService } from './analytics.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User } from '@asteai/types';

@ApiTags('analytics')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('analytics')
export class AnalyticsController {
  constructor(private readonly svc: AnalyticsService) {}

  @Get('employer/dashboard')
  @Roles('Employer', 'Admin')
  employerDashboard(@CurrentUser() user: User) {
    if (!user.tenantId) return {};
    return this.svc.getEmployerDashboard(user.tenantId);
  }

  /** Live KPIs for the Hire workspace; admins without a company see the whole platform. */
  @Get('employer/hiring-kpis')
  @Roles('Employer', 'Admin')
  hiringKpis(@CurrentUser() user: User) {
    if (!user.tenantId && user.role !== 'Admin') return null;
    return this.svc.getHiringKpis(user.tenantId ?? null);
  }

  @Get('employer/fairness')
  @Roles('Employer', 'Admin')
  fairness(@CurrentUser() user: User) {
    if (!user.tenantId) return [];
    return this.svc.getFairnessReport(user.tenantId);
  }
}
