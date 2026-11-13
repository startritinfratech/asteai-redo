import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';

import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { LocalStrategy } from './strategies/local.strategy';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AccountController } from './account.controller';
import { AccountSecurityService } from './account-security.service';
import { TwoFactorService } from './two-factor.service';
import { SignupOtpService } from './signup-otp.service';

@Module({
  imports: [
    PassportModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.getOrThrow('JWT_SECRET'),
        signOptions: { expiresIn: config.get('JWT_EXPIRES_IN', '15m') },
      }),
    }),
  ],
  controllers: [AuthController, AccountController],
  providers: [AuthService, AccountSecurityService, TwoFactorService, SignupOtpService, LocalStrategy, JwtStrategy],
  exports: [AuthService, AccountSecurityService, TwoFactorService, JwtModule],
})
export class AuthModule {}
