import { Injectable } from '@nestjs/common';
import { AiService } from '../ai/ai.service';

/** Translation / language detection, proxied to deeptech_ai through the shared AiService client. */
@Injectable()
export class VoiceService {
  constructor(private readonly ai: AiService) {}

  translate(text: string, from: string, to: string) {
    return this.ai.post<{ translated: string }>('/voice/translate', { text, from_lang: from, to_lang: to });
  }

  detect(text: string) {
    return this.ai.post<{ lang: string; confidence: number }>('/voice/detect', { text });
  }
}
