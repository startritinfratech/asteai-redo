import { Logger, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PAYMENT_PROVIDER, RazorpayProvider, type PaymentProvider } from './payment-provider';
import { NotificationsModule } from '../notifications/notifications.module';
import { PaymentsAdminController } from './payments-admin.controller';
import { PaymentsController } from './payments.controller';
import { PAYMENTS_CONFIG, PaymentsService, type PaymentsConfig } from './payments.service';

/**
 * Razorpay payments. Without RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET the app still boots and
 * payment endpoints answer 503 "Payments are not configured". Development uses Razorpay
 * test-mode keys (rzp_test_…).
 */
@Module({
  imports: [NotificationsModule],
  controllers: [PaymentsController, PaymentsAdminController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENTS_CONFIG,
      inject: [ConfigService],
      useFactory: (config: ConfigService): PaymentsConfig => ({
        keyId: config.get<string>('RAZORPAY_KEY_ID') || undefined,
        keySecret: config.get<string>('RAZORPAY_KEY_SECRET') || undefined,
        webhookSecret: config.get<string>('RAZORPAY_WEBHOOK_SECRET') || undefined,
      }),
    },
    {
      provide: PAYMENT_PROVIDER,
      inject: [PAYMENTS_CONFIG],
      useFactory: (config: PaymentsConfig): PaymentProvider | null => {
        if (!config.keyId || !config.keySecret) {
          new Logger('PaymentsModule').warn('RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET not set: payments are disabled');
          return null;
        }
        if (!config.webhookSecret) {
          new Logger('PaymentsModule').warn('RAZORPAY_WEBHOOK_SECRET not set: payments are only confirmed by the browser callback');
        }
        return new RazorpayProvider(config.keyId, config.keySecret);
      },
    },
  ],
  exports: [PaymentsService],
})
export class PaymentsModule {}
