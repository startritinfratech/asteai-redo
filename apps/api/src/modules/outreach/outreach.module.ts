import {
  Body, Controller, Get, HttpCode, Module, Param, Post, Query, Res, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength, ValidateNested,
} from 'class-validator';
import { createHmac } from 'crypto';
import type { Response } from 'express';
import type { MessageDelivery, User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TalentPoolsModule } from '../talent-pools/talent-pools.module';
import { OutreachDispatcher } from './outreach.dispatcher';
import { MAX_RECIPIENTS, OUTREACH_CONFIG, OutreachService, type OutreachConfig } from './outreach.service';

class RecipientDto {
  @ApiProperty() @IsString() @MaxLength(255) email!: string;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(160) fullName?: string;
}

export class CreateCampaignDto {
  @ApiProperty() @IsString() @MinLength(2) @MaxLength(120) name!: string;
  @ApiProperty({ example: '{{companyName}} is hiring: {{jobTitle}}' }) @IsString() @MinLength(3) @MaxLength(200) subjectTemplate!: string;
  @ApiProperty({ example: 'Hi {{firstName}},\n\n…\n\n{{senderName}}' }) @IsString() @MinLength(10) @MaxLength(10_000) bodyTemplate!: string;
  @ApiPropertyOptional({ minimum: 1, maximum: 300, default: 60 }) @IsOptional() @IsInt() @Min(1) @Max(300) ratePerMinute?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(64) requisitionId?: string;
  @ApiPropertyOptional() @IsOptional() @IsUUID() poolId?: string;
  @ApiPropertyOptional({ type: [String] }) @IsOptional() @IsArray() @ArrayMaxSize(12) @Matches(/^[a-z0-9_]{1,40}$/, { each: true }) poolColumns?: string[];
  @ApiPropertyOptional({ type: [RecipientDto] })
  @IsOptional() @IsArray() @ArrayMaxSize(MAX_RECIPIENTS) @ValidateNested({ each: true }) @Type(() => RecipientDto)
  recipients?: RecipientDto[];
}

const DELIVERIES: MessageDelivery[] = ['queued', 'sending', 'sent', 'failed', 'skipped', 'cancelled'];

@ApiTags('outreach')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Roles('Employer', 'Admin')
@Controller('outreach/campaigns')
export class OutreachController {
  constructor(private readonly svc: OutreachService) {}

  @Get() list(@CurrentUser() u: User) { return this.svc.list(u); }

  @Post()
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Create a draft campaign: templates plus a pool or a recipient list' })
  create(@CurrentUser() u: User, @Body() dto: CreateCampaignDto) { return this.svc.create(u, dto); }

  @Get(':id') get(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.get(u, id); }

  @Get(':id/messages')
  messages(@CurrentUser() u: User, @Param('id') id: string, @Query('status') status?: string) {
    return this.svc.messages(u, id, DELIVERIES.includes(status as MessageDelivery) ? (status as MessageDelivery) : undefined);
  }

  @Post(':id/queue')
  @HttpCode(200)
  @Throttle({ short: { ttl: 60_000, limit: 3 } })
  @ApiOperation({ summary: 'Queue the campaign: rendered per recipient, sent at its rate (daily company limit applies)' })
  queue(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.queue(u, id); }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() u: User, @Param('id') id: string) { return this.svc.cancel(u, id); }
}

/** Public: the unsubscribe link in every outreach email (signed token, no login). */
@ApiTags('outreach')
@SkipThrottle()
@Controller('outreach')
export class OutreachUnsubscribeController {
  constructor(private readonly svc: OutreachService) {}

  @Get('unsubscribe')
  async unsubscribe(@Query('token') token: string, @Res() res: Response) {
    const ok = await this.svc.unsubscribe(token ?? '');
    res.status(ok ? 200 : 400).type('html').send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width">
<title>${ok ? 'Unsubscribed' : 'Link not valid'}</title>
<body style="font-family:Segoe UI,Arial,sans-serif;max-width:480px;margin:64px auto;padding:0 16px;color:#121124">
<h1 style="font-size:1.4rem">${ok ? 'You’re unsubscribed' : 'This link isn’t valid'}</h1>
<p>${ok ? 'You won’t receive outreach emails from this company through AsteAI again.' : 'The unsubscribe link is incomplete or was changed. Use the link from the email.'}</p>
</body>`);
  }
}

@Module({
  imports: [TalentPoolsModule],
  controllers: [OutreachController, OutreachUnsubscribeController],
  providers: [
    OutreachService,
    OutreachDispatcher,
    {
      provide: OUTREACH_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): OutreachConfig => ({
        dailyLimit: Number(config.get('OUTREACH_DAILY_LIMIT') ?? 2000),
        // Separate from JWT_SECRET by derivation, so an unsubscribe token is never a login secret.
        unsubscribeSecret: config.get<string>('OUTREACH_UNSUBSCRIBE_SECRET')
          || createHmac('sha256', config.getOrThrow<string>('JWT_SECRET')).update('outreach-unsubscribe').digest('hex'),
      }),
    },
  ],
})
export class OutreachModule {}
