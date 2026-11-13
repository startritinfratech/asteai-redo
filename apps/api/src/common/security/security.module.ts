import { Global, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BotCheckService } from './bot-check.service';

/** Shared request-security helpers (bot checks for public forms). */
@Global()
@Module({
  providers: [{ provide: BotCheckService, inject: [ConfigService], useFactory: (c: ConfigService) => new BotCheckService(c) }],
  exports: [BotCheckService],
})
export class SecurityModule {}
