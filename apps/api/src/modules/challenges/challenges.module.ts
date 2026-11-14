import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CredentialsModule } from '../credentials/credentials.module';
import { PassportsModule } from '../passports/passports.module';
import { ChallengesController } from './challenges.controller';
import { ChallengesService } from './challenges.service';
import { CODE_RUNNER, Judge0Runner } from './code-runner';

/** Code challenges. Needs a sandboxed Judge0 (JUDGE0_URL, optional JUDGE0_AUTH_TOKEN). */
@Module({
  imports: [PassportsModule, CredentialsModule],
  controllers: [ChallengesController],
  providers: [
    ChallengesService,
    {
      provide: CODE_RUNNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const url = config.get<string>('JUDGE0_URL');
        if (!url) {
          new Logger('ChallengesModule').warn('JUDGE0_URL not set: challenge submissions are disabled');
          return null;
        }
        return new Judge0Runner(url, config.get<string>('JUDGE0_AUTH_TOKEN') || undefined);
      },
    },
  ],
})
export class ChallengesModule {}
