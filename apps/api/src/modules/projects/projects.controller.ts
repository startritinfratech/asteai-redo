import {
  Body, Controller, Get, GoneException, Param, Patch, Post, Query, UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { paginate } from '../../common/utils/pagination';
import {
  CreateDisputeDto, CreateProjectDto, ResolveDisputeDto, UpdateProjectStageDto,
} from './dto/project.dto';
import { ProjectsService } from './projects.service';

/** The 410 message for the retired PATCH /projects/:id/milestones/:milestoneId. */
export const LEGACY_MILESTONES_GONE =
  'Project milestones are retired; milestones and escrow are managed on the project contract: '
  + 'POST /contracts/:id/milestones/:milestoneId/{fund|submit|request-revision|accept|release} (see GET /contracts).';

@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('projects')
export class ProjectsController {
  constructor(private readonly svc: ProjectsService) {}

  @Get('open')
  findOpen(@Query('page') page?: string, @Query('pageSize') pageSize?: string) {
    return this.svc.findOpen(paginate(page, pageSize));
  }

  @Get('services')
  findServices() {
    return this.svc.findServices();
  }

  @Get('disputes')
  findDisputes(@CurrentUser() user: User) {
    return this.svc.findDisputes(user);
  }

  @Post('disputes')
  createDispute(@Body() body: CreateDisputeDto, @CurrentUser() user: User) {
    return this.svc.createDispute(body, user);
  }

  @Patch('disputes/:id/resolve')
  @Roles('Admin')
  resolveDispute(@Param('id') id: string, @Body() body: ResolveDisputeDto) {
    return this.svc.resolveDispute(id, body.resolution);
  }

  @Get('mine')
  @Roles('Buyer')
  myProjects(@CurrentUser() user: User) {
    return this.svc.findForUser(user.id, 'buyer');
  }

  @Get('assigned')
  @Roles('Freelancer')
  assigned(@CurrentUser() user: User) {
    return this.svc.findForUser(user.id, 'freelancer');
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.findOne(id, user);
  }

  @Post()
  @Roles('Buyer')
  create(@Body() body: CreateProjectDto, @CurrentUser() user: User) {
    return this.svc.create(body, user);
  }

  @Patch(':id/stage')
  @Roles('Buyer', 'Admin')
  updateStage(@Param('id') id: string, @Body() body: UpdateProjectStageDto, @CurrentUser() user: User) {
    return this.svc.updateStage(id, body.stage, user);
  }

  /**
   * Retired: money and milestone state now live on contracts (POST /contracts/:id/milestones/:mid/…).
   * projects.milestones is kept read-only as legacy data. No body is validated: every call is 410.
   */
  @Patch(':id/milestones/:milestoneId')
  updateMilestone(): never {
    throw new GoneException(LEGACY_MILESTONES_GONE);
  }
}
