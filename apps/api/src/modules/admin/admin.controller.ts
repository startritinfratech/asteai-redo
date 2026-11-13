import { Controller, Get, Post, Body, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { AdminService } from './admin.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User } from '@asteai/types';
import { paginate } from '../../common/utils/pagination';
import { SetFeatureFlagDto } from './dto/set-feature-flag.dto';

@ApiTags('admin')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Admin')
@Controller('admin')
export class AdminController {
  constructor(private readonly svc: AdminService) {}

  @Get('stats')
  stats() { return this.svc.getMasterStats(); }

  @Get('audit')
  audit(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    const { pageSize: size, offset } = paginate(page, pageSize, 50, 200);
    return this.svc.getAuditLog(size, offset);
  }

  @Get('flags')
  getFlags() {
    return this.svc.getFeatureFlags();
  }

  @Post('flags')
  setFlag(@Body() body: SetFeatureFlagDto, @CurrentUser() user: User) {
    return this.svc.setFeatureFlag(body.name, body.value, user.id);
  }

  @Get('trust')
  getTrust() {
    return this.svc.getTrustMetrics();
  }
}
