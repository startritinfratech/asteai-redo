import {
  Body, Controller, Get, Headers, HttpCode, Post, Query, Req, UseGuards, type RawBodyRequest,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle, Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { BillingService } from './billing.service';
import { CreateSubscriptionDto, CreateTopupDto, VerifyTopupDto } from './credits.contracts';
import { CreditsService } from './credits.service';

const jwt = AuthGuard('jwt');

/**
 * AI credits: wallet, ledger, top-ups and the Pro subscription. No endpoint adds credits
 * on the browser's word: only a verified Razorpay payment (webhook, or the signed
 * checkout callback) or the server itself grants them.
 */
@ApiTags('credits')
@Controller('credits')
export class CreditsController {
  constructor(private readonly credits: CreditsService, private readonly billing: BillingService) {}

  @Get('wallet')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Credit balance and subscription tier' })
  wallet(@CurrentUser() user: User) {
    return this.credits.getWallet(user.id);
  }

  @Get('transactions')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Credit ledger, newest first (50 per page)' })
  transactions(@CurrentUser() user: User, @Query('page') page?: string) {
    return this.credits.listTransactions(user.id, page);
  }

  @Get('packs')
  @ApiOperation({ summary: 'Top-up packs on sale' })
  packs() {
    return this.billing.listPacks();
  }

  @Post('topups')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Create a Razorpay order for a credit pack' })
  createTopup(@CurrentUser() user: User, @Body() dto: CreateTopupDto) {
    return this.billing.createTopup(user.id, dto.packId);
  }

  @Post('topups/verify')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @HttpCode(200)
  @ApiOperation({ summary: 'Checkout success callback (signature-checked); the webhook credits it too' })
  verifyTopup(@CurrentUser() user: User, @Body() dto: VerifyTopupDto) {
    return this.billing.verifyTopup(user.id, dto.orderId, dto.paymentId, dto.signature);
  }

  @Post('subscriptions')
  @UseGuards(jwt)
  @ApiBearerAuth()
  @Throttle({ short: { ttl: 60_000, limit: 5 } })
  @ApiOperation({ summary: 'Start a Pro subscription (INR 499/month) with Razorpay' })
  subscribe(@CurrentUser() user: User, @Body() _dto: CreateSubscriptionDto) {
    return this.billing.createProSubscription(user.id);
  }

  /** No auth: Razorpay signs the raw body (X-Razorpay-Signature). Needs { rawBody: true } (main.ts). */
  @Post('razorpay/webhook')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Razorpay webhook for top-ups and subscriptions (signature-verified)' })
  webhook(@Req() req: RawBodyRequest<Request>, @Headers('x-razorpay-signature') signature: string | undefined) {
    return this.billing.handleWebhook(req.rawBody, signature);
  }
}
