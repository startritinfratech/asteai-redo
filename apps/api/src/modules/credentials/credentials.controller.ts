import { Controller, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { CredentialsService } from './credentials.service';

/** Public verification: what a QR code or a shared link resolves to. */
@ApiTags('credentials')
@Controller('verify')
export class VerifyController {
  constructor(private readonly svc: CredentialsService) {}

  /** Ed25519 public keys (JWK set), for verifying credentials offline. */
  @Get('keys')
  @ApiOperation({ summary: 'Public keys that sign AsteAI credentials (JWKS)' })
  keys() {
    return this.svc.jwks();
  }

  @Get(':code')
  @Throttle({ short: { ttl: 60_000, limit: 30 } })
  @ApiOperation({ summary: 'Verify a credential code; returns its signed claims and the proof' })
  verify(@Param('code') code: string) {
    return this.svc.verify(code);
  }
}

@ApiTags('credentials')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'))
@Controller('credentials')
export class CredentialsController {
  constructor(private readonly svc: CredentialsService) {}

  @Get('me')
  mine(@CurrentUser() user: User) {
    return this.svc.listMine(user.id);
  }

  @Post(':code/revoke')
  @HttpCode(200)
  revoke(@CurrentUser() user: User, @Param('code') code: string) {
    return this.svc.revoke(user.id, code);
  }
}
