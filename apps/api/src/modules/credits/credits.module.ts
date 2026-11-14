import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BillingService } from './billing.service';
import { CreditChargeInterceptor } from './charge-credits';
import { CreditsController } from './credits.controller';
import { CreditsService } from './credits.service';
import { BILLING_CONFIG, BILLING_PROVIDER, RazorpayBillingProvider, type BillingConfig } from './razorpay-billing';

/**
 * AI credits. Other modules import this and meter their endpoints with
 * `@UseInterceptors(CreditChargeInterceptor) @ChargeCredits('<feature>')`, or wrap
 * non-HTTP work in `CreditsService.runMetered()`.
 *
 * Webhook secret: RAZORPAY_CREDITS_WEBHOOK_SECRET (a separate Razorpay webhook pointed at
 * /api/v1/credits/razorpay/webhook), falling back to RAZORPAY_WEBHOOK_SECRET.
 */
@Module({
  controllers: [CreditsController],
  providers: [
    CreditsService,
    BillingService,
    CreditChargeInterceptor,
    {
      provide: BILLING_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): BillingConfig => ({
        keyId: config.get<string>('RAZORPAY_KEY_ID') || undefined,
        keySecret: config.get<string>('RAZORPAY_KEY_SECRET') || undefined,
        webhookSecret: config.get<string>('RAZORPAY_CREDITS_WEBHOOK_SECRET') || config.get<string>('RAZORPAY_WEBHOOK_SECRET') || undefined,
        proPlanId: config.get<string>('RAZORPAY_PRO_PLAN_ID') || undefined,
      }),
    },
    {
      provide: BILLING_PROVIDER,
      inject: [BILLING_CONFIG],
      useFactory: (c: BillingConfig) => {
        if (!c.keyId || !c.keySecret) {
          new Logger('CreditsModule').warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set: credit purchases are disabled');
          return null;
        }
        return new RazorpayBillingProvider(c.keyId, c.keySecret);
      },
    },
  ],
  exports: [CreditsService, CreditChargeInterceptor],
})
export class CreditsModule {}
