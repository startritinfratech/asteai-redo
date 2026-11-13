import { Global, Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EmailService } from './email.service';
import { EmailWorker } from './email.worker';
import { EMAIL_TRANSPORT, LogTransport, SesTransport, type EmailTransport } from './transports';

/**
 * Outgoing email: EmailService queues, EmailWorker sends. EMAIL_TRANSPORT picks the
 * sender: `ses` (AWS SES v2) or `log` (development: written to the log, not sent).
 */
@Global()
@Module({
  providers: [
    EmailService,
    EmailWorker,
    {
      provide: EMAIL_TRANSPORT,
      inject: [ConfigService],
      useFactory: (config: ConfigService): EmailTransport => {
        if (config.get<string>('EMAIL_TRANSPORT') === 'ses') {
          return new SesTransport(
            config.getOrThrow<string>('AWS_REGION'),
            config.getOrThrow<string>('EMAIL_FROM'),
            config.get<string>('EMAIL_REPLY_TO') || undefined,
            config.get<string>('SES_CONFIGURATION_SET') || undefined,
          );
        }
        if (config.get<string>('NODE_ENV') === 'production') {
          new Logger('EmailModule').warn('EMAIL_TRANSPORT is not "ses": emails are logged, not sent');
        }
        return new LogTransport();
      },
    },
  ],
  exports: [EmailService],
})
export class EmailModule {}
