import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { DetectLanguageDto, TranslateDto } from './dto/voice.dto';
import { VoiceService } from './voice.service';

@ApiTags('voice')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('voice')
export class VoiceController {
  constructor(private readonly svc: VoiceService) {}

  @Post('translate')
  @HttpCode(200)
  translate(@Body() body: TranslateDto) {
    return this.svc.translate(body.text, body.from, body.to);
  }

  @Post('detect')
  @HttpCode(200)
  detect(@Body() body: DetectLanguageDto) {
    return this.svc.detect(body.text);
  }
}
