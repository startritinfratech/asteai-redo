import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { TenantsService } from './tenants.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { assertTenantAccess } from '../../common/utils/access';
import { AddTeamMemberDto, CreateOutreachDto, CreatePoolDto, TopUpCreditsDto } from './dto/tenant.dto';

/** Every `:id` route is limited to the caller's own tenant; admins may act on any tenant. */
@ApiTags('tenants')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('tenants')
export class TenantsController {
  constructor(private readonly svc: TenantsService) {}

  @Get()
  @Roles('Admin')
  findAll() { return this.svc.findAll(); }

  @Get(':id')
  @Roles('Admin', 'Employer')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.findOne(id);
  }

  @Get(':id/team')
  @Roles('Admin', 'Employer')
  getTeam(@Param('id') id: string, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.getTeam(id);
  }

  @Post(':id/team')
  @Roles('Admin', 'Employer')
  addTeamMember(@Param('id') id: string, @Body() body: AddTeamMemberDto, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.addTeamMember(id, body);
  }

  @Get(':id/pools')
  @Roles('Admin', 'Employer')
  getPools(@Param('id') id: string, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.getPools(id);
  }

  @Post(':id/pools')
  @Roles('Admin', 'Employer')
  createPool(@Param('id') id: string, @Body() body: CreatePoolDto, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.createPool(id, body);
  }

  @Get(':id/outreach')
  @Roles('Admin', 'Employer')
  getOutreach(@Param('id') id: string, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.getOutreach(id);
  }

  @Post(':id/outreach')
  @Roles('Admin', 'Employer')
  createOutreach(@Param('id') id: string, @Body() body: CreateOutreachDto, @CurrentUser() user: User) {
    assertTenantAccess(user, id);
    return this.svc.createOutreach(id, body);
  }

  /** Admin-only manual credit grant. Self-serve purchases must go through a payment provider. */
  @Post(':id/credits')
  @Roles('Admin')
  topUpCredits(@Param('id') id: string, @Body() body: TopUpCreditsDto) {
    return this.svc.updateCredits(id, body.amount);
  }
}
