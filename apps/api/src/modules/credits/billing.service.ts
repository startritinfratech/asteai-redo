import {
  BadGatewayException, BadRequestException, Inject, Injectable, InternalServerErrorException, Logger, NotFoundException,
  Optional, ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { Pool } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { PaymentProviderError } from '../payments/payment-provider';
import { verifyCheckoutSignature, verifyWebhookSignature } from '../payments/signatures';
import {
  MAX_PACK_DISCOUNT, type CreditPack, type SubscriptionCheckout, type TopupCheckout, type TopupVerifyResult,
} from './credits.contracts';
import { CreditsService } from './credits.service';
import { BILLING_CONFIG, BILLING_PROVIDER, type BillingConfig, type BillingProvider } from './razorpay-billing';

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'refused';

/** Ten years of monthly charges; the user cancels whenever they like. */
const SUBSCRIPTION_TOTAL_COUNT = 120;

interface RazorpayEntity<T> { entity?: T }
interface PaymentEntity { id?: string; order_id?: string; amount?: number; status?: string }
interface SubscriptionEntity { id?: string; plan_id?: string; status?: string; current_end?: number | null }
interface WebhookBody {
  event?: string;
  payload?: {
    order?: RazorpayEntity<{ id?: string; amount_paid?: number }>;
    payment?: RazorpayEntity<PaymentEntity>;
    subscription?: RazorpayEntity<SubscriptionEntity>;
  };
}

const SUBSCRIPTION_STATUSES = new Set(['created', 'authenticated', 'active', 'pending', 'halted', 'cancelled', 'completed']);
const ENDED = new Set(['halted', 'cancelled', 'completed']);

/**
 * Money in: Razorpay top-up orders, the Pro subscription, and the webhook that credits
 * them. The webhook is the source of truth; the checkout callback is only a fast path.
 * Every credit is idempotent (pending → completed flip, or a unique payment reference),
 * so retries and the callback/webhook race are harmless.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly credits: CreditsService,
    @Inject(BILLING_CONFIG) private readonly config: BillingConfig,
    @Optional() @Inject(BILLING_PROVIDER) private readonly provider: BillingProvider | null,
  ) {}

  private ready(): { provider: BillingProvider; keyId: string } {
    if (!this.provider || !this.config.keyId) throw new ServiceUnavailableException('Payments are not configured');
    return { provider: this.provider, keyId: this.config.keyId };
  }

  /**
   * Packs from platform_settings.credit_packs. A malformed pack, or one discounted by more
   * than MAX_PACK_DISCOUNT against its list price, is left off sale rather than sold.
   */
  async listPacks(): Promise<CreditPack[]> {
    const { rows } = await this.db.query<{ value: unknown }>(`SELECT value FROM platform_settings WHERE key = 'credit_packs'`);
    const list = Array.isArray(rows[0]?.value) ? (rows[0].value as unknown[]) : [];
    return list.flatMap((raw): CreditPack[] => {
      const x = raw as Partial<CreditPack> | null;
      if (!x || typeof x.id !== 'string' || !Number.isInteger(x.credits) || (x.credits ?? 0) <= 0) return [];
      if (!Number.isInteger(x.priceMinor) || (x.priceMinor ?? 0) < 100) return [];
      const price = x.priceMinor as number;
      const list = Number.isInteger(x.listPriceMinor) ? (x.listPriceMinor as number) : price;
      if (list < price || price < Math.ceil(list * (1 - MAX_PACK_DISCOUNT))) {
        this.logger.warn(`Credit pack ${x.id} is mispriced (price ${price}, list ${list}); not offered`);
        return [];
      }
      const discountPercent = Math.round((1 - price / list) * 100);
      return [{ id: x.id, credits: x.credits as number, priceMinor: price, listPriceMinor: list, discountPercent }];
    });
  }

  // ── Top-ups ─────────────────────────────────────────────────────────────────

  async createTopup(userId: string, packId: string): Promise<TopupCheckout> {
    const { provider, keyId } = this.ready();
    const pack = (await this.listPacks()).find((p) => p.id === packId);
    if (!pack) throw new NotFoundException('Unknown credit pack');

    const order = await this.call(() => provider.createOrder({
      amountMinor: pack.priceMinor,
      receipt: `cr_${randomUUID().replace(/-/g, '').slice(0, 30)}`,
      notes: { purpose: 'credit_topup', user_id: userId, pack_id: pack.id, credits: String(pack.credits) },
    }));
    await this.credits.createPendingTopup(userId, order.id, pack.credits, { packId: pack.id, priceMinor: pack.priceMinor });
    return { orderId: order.id, keyId, amountMinor: pack.priceMinor, currency: 'INR', credits: pack.credits };
  }

  /** Browser fast path after Checkout succeeds. */
  async verifyTopup(userId: string, orderId: string, paymentId: string, signature: string): Promise<TopupVerifyResult> {
    if (!this.config.keySecret) throw new ServiceUnavailableException('Payments are not configured');
    if (!verifyCheckoutSignature(orderId, paymentId, signature, this.config.keySecret)) {
      throw new BadRequestException('Invalid payment signature');
    }
    const outcome = await this.credits.completeTopup(orderId, paymentId, { userId });
    if (outcome === 'unknown') throw new NotFoundException('Unknown order');
    // 'duplicate': the webhook got there first, so the credits are already in.
    const status = outcome === 'amount_mismatch' ? 'amount_mismatch' : 'credited';
    return { status, wallet: await this.credits.getWallet(userId) };
  }

  // ── Subscriptions ───────────────────────────────────────────────────────────

  async createProSubscription(userId: string): Promise<SubscriptionCheckout> {
    const { provider, keyId } = this.ready();
    const { rows } = await this.db.query<{ price_minor: number | null; razorpay_plan_id: string | null }>(
      `SELECT price_minor, razorpay_plan_id FROM plans WHERE id = 'pro' AND is_active`,
    );
    const planId = rows[0]?.razorpay_plan_id || this.config.proPlanId;
    if (!rows.length || !planId || !rows[0].price_minor) throw new ServiceUnavailableException('The Pro plan is not available');

    const wallet = await this.credits.getWallet(userId);
    if (wallet.subscriptionTier !== 'free' && wallet.subscriptionStatus === 'active') {
      throw new BadRequestException('You already have an active subscription');
    }

    const sub = await this.call(() => provider.createSubscription({
      planId, totalCount: SUBSCRIPTION_TOTAL_COUNT, notes: { purpose: 'subscription', user_id: userId, tier: 'pro' },
    }));
    await this.db.query(
      `UPDATE wallets SET razorpay_subscription_id = $2, subscription_status = 'created', updated_at = NOW()
        WHERE user_id = $1`,
      [userId, sub.id],
    );
    return { subscriptionId: sub.id, keyId, tier: 'pro', priceMinor: Number(rows[0].price_minor) };
  }

  // ── Webhook ─────────────────────────────────────────────────────────────────

  /**
   * POST /credits/razorpay/webhook. 400 for a missing or wrong signature (HMAC-SHA256 of
   * the raw body with the webhook secret); 200 for everything signed, including events
   * that are ignored or refused for a business reason; 500 on an unexpected failure, so
   * Razorpay retries.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined): Promise<{ outcome: WebhookOutcome }> {
    if (!this.config.webhookSecret) throw new ServiceUnavailableException('Payments are not configured');
    if (!rawBody) throw new InternalServerErrorException('Webhook body unavailable');
    if (!verifyWebhookSignature(rawBody, signature, this.config.webhookSecret)) {
      this.logger.warn('Rejected a credits webhook with a missing or invalid signature');
      throw new BadRequestException('Invalid webhook signature');
    }
    let body: WebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WebhookBody;
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }
    const type = typeof body?.event === 'string' ? body.event : '';
    const outcome = await this.dispatch(type, body);
    this.logger.log(`Razorpay ${type || '(no event)'}: ${outcome}`);
    return { outcome };
  }

  private async dispatch(type: string, body: WebhookBody): Promise<WebhookOutcome> {
    const payment = body.payload?.payment?.entity;
    const sub = body.payload?.subscription?.entity;

    switch (type) {
      case 'order.paid':
      case 'payment.captured': {
        const orderId = body.payload?.order?.entity?.id ?? payment?.order_id;
        if (!orderId || !payment?.id) return 'ignored';
        const paid = Number(body.payload?.order?.entity?.amount_paid ?? payment.amount);
        const r = await this.credits.completeTopup(orderId, payment.id, { paidMinor: paid });
        if (r === 'amount_mismatch') this.logger.error(`Top-up order ${orderId} paid ${paid}, which is not its price`);
        return r === 'credited' ? 'processed' : r === 'duplicate' ? 'duplicate' : r === 'unknown' ? 'ignored' : 'refused';
      }
      case 'subscription.charged':
        return sub?.id && payment?.id ? this.subscriptionCharged(sub, payment) : 'ignored';
      default:
        if (type.startsWith('subscription.') && sub?.id) return this.subscriptionStatus(sub);
        return 'ignored';
    }
  }

  /** A monthly Pro payment: tier pro, and that month's credits, expiring with the period. */
  private async subscriptionCharged(sub: SubscriptionEntity, payment: PaymentEntity): Promise<WebhookOutcome> {
    const { rows } = await this.db.query<{ user_id: string; price_minor: number | null; monthly_credits: number }>(
      `SELECT w.user_id, p.price_minor, p.monthly_credits
         FROM wallets w CROSS JOIN plans p
        WHERE w.razorpay_subscription_id = $1 AND p.id = 'pro'`,
      [sub.id],
    );
    if (!rows.length) return 'ignored';
    const { user_id: userId, price_minor: price, monthly_credits: credits } = rows[0];
    if (Number(payment.amount) !== Number(price)) {
      this.logger.error(`Subscription ${sub.id} charged ${payment.amount}, expected ${price}`);
      return 'refused';
    }
    const periodEnd = sub.current_end ? new Date(sub.current_end * 1000) : new Date(Date.now() + 31 * 86_400_000);
    await this.db.query(
      `UPDATE wallets SET subscription_tier = 'pro', subscription_status = 'active', current_period_end = $2, updated_at = NOW()
        WHERE user_id = $1`,
      [userId, periodEnd],
    );
    if (Number(credits) <= 0) return 'processed';
    const granted = await this.credits.grantCredits(userId, {
      type: 'grant', amount: Number(credits), expiresAt: periodEnd, reference: payment.id,
      metadata: { source: 'subscription', subscriptionId: sub.id, tier: 'pro' },
    });
    return granted ? 'processed' : 'duplicate';
  }

  private async subscriptionStatus(sub: SubscriptionEntity): Promise<WebhookOutcome> {
    const status = sub.status && SUBSCRIPTION_STATUSES.has(sub.status) ? sub.status : null;
    if (!status) return 'ignored';
    const { rowCount } = await this.db.query(
      `UPDATE wallets
          SET subscription_status = $2,
              subscription_tier = CASE WHEN $3 THEN 'free' ELSE subscription_tier END,
              updated_at = NOW()
        WHERE razorpay_subscription_id = $1`,
      [sub.id, status, ENDED.has(status)],
    );
    return rowCount ? 'processed' : 'ignored';
  }

  private async call<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      if (err instanceof PaymentProviderError) {
        this.logger.warn(`Razorpay call failed: ${err.message}`);
        throw new BadGatewayException('The payment provider is unavailable. Please try again.');
      }
      throw err;
    }
  }
}
