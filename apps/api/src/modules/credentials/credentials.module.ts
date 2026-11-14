import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { signerFromConfig } from './credential-signer';
import { CredentialsController, VerifyController } from './credentials.controller';
import { CREDENTIAL_SIGNER, CredentialsService } from './credentials.service';

@Module({
  controllers: [VerifyController, CredentialsController],
  providers: [
    CredentialsService,
    {
      provide: CREDENTIAL_SIGNER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const signer = signerFromConfig((k) => config.get<string>(k));
        if (!signer) new Logger('CredentialsModule').warn('CREDENTIAL_SIGNING_KEY not set: credentials cannot be issued or verified');
        else if (!config.get('CREDENTIAL_SIGNING_KEY')) {
          new Logger('CredentialsModule').warn('Using a development credential key derived from JWT_SECRET; set CREDENTIAL_SIGNING_KEY');
        }
        return signer;
      },
    },
  ],
  exports: [CredentialsService],
})
export class CredentialsModule {}
