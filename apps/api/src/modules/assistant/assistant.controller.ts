import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VoiceCommandDto } from './dto/voice-command.dto';
import { AssistantService } from './assistant.service';

@ApiTags('assistant')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('assistant')
export class AssistantController {
  constructor(private readonly svc: AssistantService) {}

  /** Resolves one spoken command to an action on the targets the browser offered. */
  @Post('command')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  command(@CurrentUser() user: User, @Body() body: VoiceCommandDto) {
    return this.svc.resolve(user, body);
  }
}
