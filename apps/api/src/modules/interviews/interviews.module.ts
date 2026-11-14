import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { CertificatesModule } from '../certificates/certificates.module';
import { CredentialsModule } from '../credentials/credentials.module';
import { CreditsModule } from '../credits/credits.module';
import { PassportsModule } from '../passports/passports.module';
import { InterviewsController, InternalResultsController } from './interviews.controller';
import { InterviewsService } from './interviews.service';
import { ClaudeInterviewModel, INTERVIEW_MODEL } from './studio/interview-model';
import { StudioController } from './studio/studio.controller';
import { StudioService } from './studio/studio.service';

@Module({
  imports: [CertificatesModule, CreditsModule, PassportsModule, CredentialsModule],
  controllers: [InterviewsController, InternalResultsController, StudioController],
  providers: [
    InterviewsService,
    StudioService,
    {
      provide: INTERVIEW_MODEL,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) {
          new Logger('InterviewsModule').warn('ANTHROPIC_API_KEY not set: AI Interview Studio is disabled');
          return null;
        }
        return new ClaudeInterviewModel(
          new Anthropic({ apiKey, timeout: 60_000, maxRetries: 1 }),
          config.get<string>('INTERVIEW_MODEL') ?? 'claude-opus-5-5',
        );
      },
    },
  ],
  exports: [InterviewsService],
})
export class InterviewsModule {}
