import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { DB_POOL } from '../../database/database.module';
import { CreditsModule } from '../credits/credits.module';
import { ClaudeResumeExtractor, RESUME_EXTRACTOR } from './resume-extractor';
import { ResumesController } from './resumes.controller';
import { RESUME_STORAGE, ResumesService, type ResumeStorageConfig } from './resumes.service';
import { AwsCredentialProvider } from './s3-presign';

/**
 * Résumé upload (S3, RESUME_BUCKET + RESUME_BUCKET_REGION or AWS_REGION) and AI autofill
 * (ANTHROPIC_API_KEY, RESUME_MODEL). The bucket needs CORS allowing PUT from the web
 * origin with the Content-Type header, and the web CSP needs its origin in connect-src
 * (NEXT_PUBLIC_RESUME_UPLOAD_ORIGIN).
 */
@Module({
  imports: [CreditsModule],
  controllers: [ResumesController],
  providers: [
    {
      provide: RESUME_STORAGE,
      inject: [ConfigService],
      useFactory: (config: ConfigService): ResumeStorageConfig | null => {
        const bucket = config.get<string>('RESUME_BUCKET');
        const region = config.get<string>('RESUME_BUCKET_REGION') || config.get<string>('AWS_REGION');
        if (!bucket || !region) {
          new Logger('ResumesModule').warn('RESUME_BUCKET / region not set: résumé uploads are disabled');
          return null;
        }
        const provider = new AwsCredentialProvider((k) => config.get<string>(k) ?? process.env[k]);
        return { bucket, region, credentials: () => provider.get() };
      },
    },
    {
      provide: RESUME_EXTRACTOR,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) return null;
        return new ClaudeResumeExtractor(
          new Anthropic({ apiKey, timeout: 90_000, maxRetries: 1 }),
          config.get<string>('RESUME_MODEL') ?? 'claude-opus-5-5',
        );
      },
    },
    {
      provide: ResumesService,
      inject: [DB_POOL, RESUME_STORAGE, RESUME_EXTRACTOR],
      useFactory: (db, storage, extractor) => new ResumesService(db, storage, extractor),
    },
  ],
})
export class ResumesModule {}
