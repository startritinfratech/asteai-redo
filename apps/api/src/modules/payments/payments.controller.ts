import { Body, Controller, Headers, HttpCode, Post, Req, UseGuards, type RawBodyRequest } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { SkipThrottle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { VerifyCheckoutDto } from './dto/payment.dto';
import { PaymentsService } from './payments.service';

/**
 * Razorpay. `verify` is the browser's fast path after Checkout succeeds; `webhook` is the
 * source of truth (it captures even if the browser never calls back). Both are idempotent.
 */
@ApiTags('payments')
@Controller('payments/razorpay')
export class PaymentsController {
  constructor(private readonly svc: PaymentsService) {}

  @Post('verify')
  @HttpCode(200)
  @ApiBearerAuth()
  @UseGuards(AuthGuard('jwt'))
  @ApiOperation({ summary: 'Verify a Razorpay Checkout result (payer only) and capture the payment' })
  verify(@Body() body: VerifyCheckoutDto, @CurrentUser() user: User) {
    return this.svc.verifyCheckout(body, user);
  }

  /**
   * No auth: Razorpay signs the raw body (X-Razorpay-Signature) with RAZORPAY_WEBHOOK_SECRET.
   * Needs NestFactory.create(AppModule, { rawBody: true }) so req.rawBody holds the exact bytes.
   */
  @Post('webhook')
  @HttpCode(200)
  @SkipThrottle()
  @ApiOperation({ summary: 'Razorpay webhook (signature-verified, deduplicated by event id)' })
  webhook(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-razorpay-signature') signature: string | undefined,
    @Headers('x-razorpay-event-id') eventId: string | undefined,
  ) {
    return this.svc.handleWebhook(req.rawBody, signature, eventId);
  }
}
