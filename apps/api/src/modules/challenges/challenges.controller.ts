import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { OptionalJwtGuard } from '../auth/optional-jwt.guard';
import { ChallengesService } from './challenges.service';
import { SubmitSolutionDto } from './dto/submit-solution.dto';

@ApiTags('challenges')
@Controller('challenges')
export class ChallengesController {
  constructor(private readonly svc: ChallengesService) {}

  @Get()
  @UseGuards(OptionalJwtGuard)
  @ApiOperation({ summary: 'Coding benchmarks (with your best score when signed in)' })
  list(@CurrentUser() user: User | null) {
    return this.svc.list(user?.id);
  }

  @Get(':id')
  @ApiOperation({ summary: 'One challenge: prompt, examples, starter code and limits (hidden tests excluded)' })
  get(@Param('id') id: string) {
    return this.svc.get(id);
  }

  @Get(':id/submissions')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  mine(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.mySubmissions(user.id, id);
  }

  /** Rate-limited: 5 a minute here, SUBMISSIONS_PER_HOUR an hour and one at a time in the service. */
  @Post(':id/submissions')
  @UseGuards(AuthGuard('jwt'))
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Submit a solution: graded in the sandbox, updates the Talent Passport' })
  submit(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: SubmitSolutionDto) {
    return this.svc.submit(user.id, id, dto);
  }
}
