import { Body, Controller, Get, HttpCode, Param, Post, Req, UseGuards, UseInterceptors } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { ChargeCredits, CreditChargeInterceptor, type MeteredRequest } from '../../credits/charge-credits';
import { StartStudioInterviewDto, StudioTurnDto } from './studio.dto';
import { StudioService } from './studio.service';

/**
 * AI Interview Studio. JSON in, JSON out; starting a session costs the `ai_interview`
 * credit price (refunded automatically if the interviewer fails to start it).
 */
@ApiTags('interviews')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('interviews')
export class StudioController {
  constructor(private readonly svc: StudioService) {}

  @Post('start')
  @UseInterceptors(CreditChargeInterceptor)
  @ChargeCredits('ai_interview')
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Start a technical or trades-voice interview; returns question 1' })
  start(@CurrentUser() user: User, @Body() dto: StartStudioInterviewDto, @Req() req: MeteredRequest) {
    return this.svc.start(user, dto, req.creditCharge?.transactionId ?? null);
  }

  @Post(':id/turn')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 20 } })
  @ApiOperation({ summary: 'Answer the current question; returns the next one (prompt null after the last)' })
  turn(@CurrentUser() user: User, @Param('id') id: string, @Body() dto: StudioTurnDto) {
    return this.svc.turn(user, id, dto);
  }

  @Post(':id/complete')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Finish: structured rubric scores, Talent Passport update and a signed credential' })
  complete(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.complete(user, id);
  }

  @Get('sessions/:id')
  @ApiOperation({ summary: 'A studio session: transcript and, once complete, its rubric result' })
  get(@CurrentUser() user: User, @Param('id') id: string) {
    return this.svc.get(user, id);
  }
}
