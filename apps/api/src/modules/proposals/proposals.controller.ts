import { Controller, Get, Post, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { ProposalsService } from './proposals.service';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { User } from '@asteai/types';
import { SubmitProposalDto } from './dto/submit-proposal.dto';

@ApiTags('proposals')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('proposals')
export class ProposalsController {
  constructor(private readonly svc: ProposalsService) {}

  @Get('project/:projectId')
  @Roles('Buyer', 'Admin')
  forProject(@Param('projectId') id: string, @CurrentUser() user: User) {
    return this.svc.findForProject(id, user);
  }

  @Get('mine')
  @Roles('Freelancer')
  mine(@CurrentUser() user: User) { return this.svc.findMine(user.id); }

  @Post()
  @Roles('Freelancer')
  submit(@Body() body: SubmitProposalDto, @CurrentUser() user: User) {
    return this.svc.submit(body, user);
  }

  @Patch(':id/award')
  @Roles('Buyer')
  award(@Param('id') id: string, @CurrentUser() user: User) {
    return this.svc.award(id, user);
  }
}
