import {
  BadGatewayException, BadRequestException, ForbiddenException, HttpException, Inject, Optional, Injectable,
  ConflictException, InternalServerErrorException, Logger, NotFoundException, ServiceUnavailableException,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { NotificationsService } from '../notifications/notifications.service';
import {
  PAYMENT_PROVIDER, PaymentProviderError, type PaymentProvider, type ProviderRefund, type RefundInput,
} from './payment-provider';
import type { PaymentOrderStatus, PaymentPurpose, VerifyCheckoutInput, VerifyCheckoutResult } from './payment.types';
import { verifyCheckoutSignature, verifyWebhookSignature } from './signatures';

export const PAYMENTS_CONFIG = 'PAYMENTS_CONFIG';

/** RAZORPAY_KEY_ID / RAZORPAY_KEY_SECRET / RAZORPAY_WEBHOOK_SECRET. Unset: payments are off (503), boot still works. */
export interface PaymentsConfig {
  keyId?: string;
  keySecret?: string;
  webhookSecret?: string;
}

export interface PaymentOrderRow {
  id: string;
  purpose: PaymentPurpose;
  escrow_payment_id: string | null;
  user_id: string;
  amount_minor: string | number; // BIGINT arrives as a string
  currency: string;
  provider: string;
  provider_order_id: string;
  status: PaymentOrderStatus;
  receipt: string | null;
  provider_payment_id: string | null;
}

/** An order whose payment Razorpay received but we could not apply (an admin refunds it). */
export interface UnappliedOrder {
  orderId: string;
  buyerName: string;
  buyerEmail: string;
  amount: number;
  currency: string;
  providerPaymentId: string | null;
  reason: string | null;
  createdAt: string;
}

export interface OpenOrderInput {
  purpose: PaymentPurpose;
  escrowPaymentId: string;
  userId: string;
  amountMinor: number;
  currency: string;
  receipt: string;
  notes: Record<string, string>;
}

export interface OpenOrder {
  orderId: string;
  amountMinor: number;
  currency: string;
  keyId: string;
  /** An open order already existed and is handed out again. */
  reused: boolean;
}

/** What a purpose (e.g. escrow funding) does once the provider confirms its order was paid. */
export interface PurposeHandler {
  onPaid(order: PaymentOrderRow, providerPaymentId: string, actor: string): Promise<{ alreadyCaptured: boolean }>;
}

export interface RefundEvent {
  providerRefundId: string;
  /** Our refunds.id, from the refund's notes, for a refund whose provider id we never stored. */
  refundId?: string;
  status: 'processed' | 'failed';
  error?: string;
  actor: string;
}
export type RefundHandler = (event: RefundEvent) => Promise<void>;

export type WebhookOutcome = 'processed' | 'duplicate' | 'ignored' | 'refused';

/** Keys removed (at any depth) before a webhook payload is stored: personal and card data. */
const PERSONAL_KEYS = new Set([
  'email', 'contact', 'phone', 'card', 'vpa', 'upi', 'bank_account', 'customer_details', 'address', 'token', 'emi',
  'name', 'billing_address', 'shipping_address',
]);

export function redactPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactPayload);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .filter(([k]) => !PERSONAL_KEYS.has(k))
      .map(([k, v]) => [k, redactPayload(v)]));
  }
  return value;
}

interface PaymentEntity { id?: string; order_id?: string; amount?: number; currency?: string; error_description?: string }
interface RefundEntity { id?: string; payment_id?: string; status?: string; notes?: Record<string, unknown> | unknown[] }
interface WebhookBody {
  event?: string;
  created_at?: number;
  payload?: {
    payment?: { entity?: PaymentEntity };
    order?: { entity?: { id?: string } };
    refund?: { entity?: RefundEntity };
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Razorpay checkout orders, the checkout callback, the webhook and refunds.
 *
 * Knows nothing about contracts: what an order pays for is its `purpose`, and the module
 * that owns that purpose registers a PurposeHandler (ContractsService registers
 * 'escrow_milestone' and the refund handler on init). Both the browser's verify call and
 * the webhook end in the same handler, which must be idempotent: whichever arrives second
 * finds the payment already captured.
 *
 * Never logs secrets, signatures or payloads (AUDIT-30); only event types and our ids.
 */
@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly purposes = new Map<PaymentPurpose, PurposeHandler>();
  private refundHandler: RefundHandler | null = null;

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    @Inject(PAYMENTS_CONFIG) private readonly config: PaymentsConfig,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | null,
    @Optional() private readonly notifications?: NotificationsService,
  ) {}

  registerPurpose(purpose: PaymentPurpose, handler: PurposeHandler) {
    this.purposes.set(purpose, handler);
  }

  registerRefundHandler(handler: RefundHandler) {
    this.refundHandler = handler;
  }

  get configured(): boolean {
    return Boolean(this.provider && this.config.keyId && this.config.keySecret);
  }

  /** 503 when the Razorpay keys are not set. Call before touching the database. */
  assertConfigured(): void {
    if (!this.configured) throw new ServiceUnavailableException('Payments are not configured');
  }

  // ─── Orders ───────────────────────────────────────────────────────────────

  /**
   * The open provider order for this escrow payment, or a new one. Call after the
   * escrow payment row is committed (no row locks held while Razorpay is called).
   *
   * Concurrent calls may both create a Razorpay order; the unique index on open orders
   * lets one insert win and the other hands out the winner's order (the unused one is
   * never shown to anyone and expires unpaid). A provider failure stores nothing, so the
   * caller can simply try again.
   */
  async openOrder(input: OpenOrderInput): Promise<OpenOrder> {
    this.assertConfigured();
    const existing = await this.findOpenOrder(input.escrowPaymentId);
    if (existing) {
      if (Number(existing.amount_minor) === input.amountMinor && existing.currency === input.currency) {
        return this.toOpenOrder(existing, true);
      }
      // The amount changed under an open order (should not happen): retire it.
      await this.db.query(
        `UPDATE payment_orders SET status = 'expired', updated_at = NOW() WHERE id = $1 AND status IN ('created', 'attempted')`,
        [existing.id],
      );
    }

    let order;
    try {
      order = await this.provider!.createOrder({
        amountMinor: input.amountMinor, currency: input.currency, receipt: input.receipt, notes: input.notes,
      });
    } catch (err) {
      this.logger.warn(`Razorpay order for escrow payment ${input.escrowPaymentId} failed: ${describe(err)}`);
      throw new BadGatewayException('Could not start the payment with Razorpay. Please try again.');
    }
    if (order.amountMinor !== input.amountMinor || order.currency !== input.currency) {
      this.logger.error(`Razorpay order ${order.id} came back with a different amount or currency`);
      throw new BadGatewayException('Could not start the payment with Razorpay. Please try again.');
    }

    try {
      const { rows } = await this.db.query<PaymentOrderRow>(
        `INSERT INTO payment_orders (purpose, escrow_payment_id, user_id, amount_minor, currency, provider,
                                     provider_order_id, status, receipt)
         VALUES ($1, $2, $3, $4, $5, 'razorpay', $6, 'created', $7)
         ON CONFLICT (escrow_payment_id) WHERE status IN ('created', 'attempted') DO NOTHING
         RETURNING *`,
        [input.purpose, input.escrowPaymentId, input.userId, input.amountMinor, input.currency, order.id, input.receipt.slice(0, 40)],
      );
      if (rows[0]) return this.toOpenOrder(rows[0], false);
    } catch (err) {
      if (!isUniqueViolation(err)) throw err;
    }
    // Lost the race: hand out the order that won.
    const winner = await this.findOpenOrder(input.escrowPaymentId);
    if (!winner) throw new BadGatewayException('Could not start the payment. Please try again.');
    return this.toOpenOrder(winner, true);
  }

  private async findOpenOrder(escrowPaymentId: string): Promise<PaymentOrderRow | undefined> {
    const { rows } = await this.db.query<PaymentOrderRow>(
      `SELECT * FROM payment_orders
        WHERE escrow_payment_id = $1 AND status IN ('created', 'attempted')
        ORDER BY created_at DESC LIMIT 1`,
      [escrowPaymentId],
    );
    return rows[0];
  }

  private toOpenOrder(row: PaymentOrderRow, reused: boolean): OpenOrder {
    return {
      orderId: row.provider_order_id, amountMinor: Number(row.amount_minor), currency: row.currency,
      keyId: this.config.keyId ?? '', reused,
    };
  }

  // ─── Checkout callback (fast path for the UI) ─────────────────────────────

  /**
   * The browser's Razorpay Checkout `handler` result. Checks the signature before anything
   * else, then that the caller is the payer, then captures through the purpose handler.
   * The webhook does the same independently; this only makes the UI update at once.
   */
  async verifyCheckout(input: VerifyCheckoutInput, user: Pick<User, 'id'>): Promise<VerifyCheckoutResult> {
    this.assertConfigured();
    if (!verifyCheckoutSignature(input.orderId, input.paymentId, input.signature, this.config.keySecret ?? '')) {
      throw new BadRequestException('Invalid payment signature');
    }
    const order = await this.orderByProviderId(input.orderId);
    if (!order) throw new NotFoundException('Payment order not found');
    if (order.user_id !== user.id) throw new ForbiddenException();
    const { alreadyCaptured } = await this.capture(order, input.paymentId, 'razorpay:verify');
    return { status: 'captured', alreadyCaptured };
  }

  private async orderByProviderId(providerOrderId: string): Promise<PaymentOrderRow | undefined> {
    const { rows } = await this.db.query<PaymentOrderRow>(
      `SELECT * FROM payment_orders WHERE provider_order_id = $1`,
      [providerOrderId],
    );
    return rows[0];
  }

  /**
   * Lets the order's purpose capture the money, then records the order as paid. If the
   * purpose refuses (a business 4xx, e.g. the contract was cancelled) the payment was still
   * received, so the order becomes 'unapplied' for an admin to refund, and the caller gets
   * the refusal with a clear message.
   */
  private async capture(order: PaymentOrderRow, providerPaymentId: string, actor: string) {
    const handler = this.purposes.get(order.purpose);
    if (!handler) throw new InternalServerErrorException(`No handler for payment purpose '${order.purpose}'`);
    let result: { alreadyCaptured: boolean };
    try {
      result = await handler.onPaid(order, providerPaymentId, actor);
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() < 500) {
        await this.markUnapplied(order, providerPaymentId, err.message);
        throw new HttpException(
          `Your payment was received but could not be applied (${err.message}). Our support team will refund it.`,
          err.getStatus(),
        );
      }
      throw err;
    }
    await this.db.query(
      `UPDATE payment_orders
          SET status = 'paid', provider_payment_id = COALESCE(provider_payment_id, $2), updated_at = NOW()
        WHERE id = $1 AND status NOT IN ('paid', 'refunded')`,
      [order.id, providerPaymentId],
    );
    return result;
  }

  /**
   * Provider money we cannot apply: flags the order, writes the audit row and tells the admins,
   * once (a repeated verify or webhook finds it already unapplied). `amountMinor` is what was
   * actually paid when that differs from the order.
   */
  private async markUnapplied(order: PaymentOrderRow, providerPaymentId: string, reason: string, amountMinor?: number, currency?: string) {
    const paidMinor = amountMinor ?? Number(order.amount_minor);
    const paidCurrency = currency ?? order.currency;
    const { rows } = await this.db.query(
      `UPDATE payment_orders
          SET status = 'unapplied', provider_payment_id = COALESCE(provider_payment_id, $2), unapplied_reason = $3,
              unapplied_amount_minor = $4, updated_at = NOW()
        WHERE id = $1 AND status NOT IN ('paid', 'unapplied', 'refunded') RETURNING id`,
      [order.id, providerPaymentId, reason.slice(0, 500), paidMinor],
    );
    if (!rows.length) return;
    const meta = { providerPaymentId, amount: paidMinor / 100, currency: paidCurrency, reason };
    await this.db.query(
      `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
       VALUES (NULL, 'payments', 'System', 'Payment received but not applied', $1, $2)`,
      [order.id, JSON.stringify(meta)],
    );
    this.logger.warn(`Payment ${providerPaymentId} for order ${order.id} received but not applied: ${reason}`);
    try {
      const { rows: admins } = await this.db.query<{ id: string }>(`SELECT id FROM user_accounts WHERE role = 'Admin'`);
      for (const admin of admins) {
        await this.notifications?.send(
          admin.id, `A payment of ${paidMinor / 100} ${paidCurrency} was received but not applied (${reason}); it needs a refund`,
          '/platform/payments',
        );
      }
    } catch (err) {
      this.logger.error(`Could not notify admins about unapplied order ${order.id}: ${describe(err)}`);
    }
  }

  // ─── Unapplied payments (admin) ───────────────────────────────────────────

  async listUnapplied(): Promise<UnappliedOrder[]> {
    const { rows } = await this.db.query<{
      id: string; first_name: string | null; last_name: string | null; email: string; amount_minor: string;
      unapplied_amount_minor: string | null; currency: string; provider_payment_id: string | null;
      unapplied_reason: string | null; created_at: Date;
    }>(
      `SELECT po.id, u.first_name, u.last_name, u.email, po.amount_minor, po.unapplied_amount_minor, po.currency,
              po.provider_payment_id, po.unapplied_reason, po.created_at
         FROM payment_orders po JOIN user_accounts u ON u.id = po.user_id
        WHERE po.status = 'unapplied' ORDER BY po.created_at DESC`,
    );
    return rows.map((r) => ({
      orderId: r.id,
      buyerName: [r.first_name, r.last_name].filter(Boolean).join(' '),
      buyerEmail: r.email,
      amount: Number(r.unapplied_amount_minor ?? r.amount_minor) / 100,
      currency: r.currency,
      providerPaymentId: r.provider_payment_id,
      reason: r.unapplied_reason,
      createdAt: new Date(r.created_at).toISOString(),
    }));
  }

  /**
   * Admin: refund an unapplied payment in full, once. The claim (refunded_at) is taken before
   * the single provider call, so a double click cannot refund twice; a refused request releases
   * the claim, a timeout keeps it (outcome unknown: check Razorpay before anything else).
   */
  async refundUnapplied(orderId: string, admin: Pick<User, 'id'>): Promise<{ status: 'refunded'; refundId: string }> {
    this.assertConfigured();
    const { rows } = await this.db.query<{
      id: string; amount_minor: string; unapplied_amount_minor: string | null; provider_payment_id: string | null;
    }>(
      `UPDATE payment_orders SET refunded_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND status = 'unapplied' AND refunded_at IS NULL
        RETURNING id, amount_minor, unapplied_amount_minor, provider_payment_id`,
      [orderId],
    );
    const claimed = rows[0];
    if (!claimed) throw new ConflictException('This payment is not waiting for a refund');
    if (!claimed.provider_payment_id) {
      await this.db.query(`UPDATE payment_orders SET refunded_at = NULL WHERE id = $1`, [orderId]);
      throw new ConflictException('This order has no provider payment to refund');
    }
    const amountMinor = Number(claimed.unapplied_amount_minor ?? claimed.amount_minor);
    let refund: ProviderRefund;
    try {
      refund = await this.provider!.refund({
        paymentId: claimed.provider_payment_id, amountMinor, receipt: orderId.slice(0, 40), notes: { paymentOrderId: orderId },
      });
    } catch (err) {
      if (err instanceof PaymentProviderError && err.kind === 'rejected') {
        await this.db.query(`UPDATE payment_orders SET refunded_at = NULL WHERE id = $1`, [orderId]);
        throw new BadGatewayException(`Razorpay refused the refund: ${err.message}`);
      }
      this.logger.error(`Refund for unapplied order ${orderId} has an unknown outcome: ${describe(err)}`);
      throw new BadGatewayException('Razorpay did not answer; check the Razorpay dashboard before trying again');
    }
    await this.db.query(
      `UPDATE payment_orders SET status = 'refunded', refund_provider_id = $2, updated_at = NOW() WHERE id = $1`,
      [orderId, refund.id],
    );
    await this.db.query(
      `INSERT INTO audit_log (actor_id, role, action, entity, meta) VALUES ($1, 'Admin', 'Unapplied payment refunded', $2, $3)`,
      [admin.id, orderId, JSON.stringify({ providerRefundId: refund.id, amount: amountMinor / 100 })],
    );
    return { status: 'refunded', refundId: refund.id };
  }

  // ─── Webhook ──────────────────────────────────────────────────────────────

  /**
   * POST /payments/razorpay/webhook. 400 for a missing or bad signature; otherwise 200,
   * including for events we do not handle and for events refused for a business reason
   * (recorded in payment_events.error for an admin to follow up). An unexpected failure
   * (e.g. the database) is a 500, so Razorpay retries; the event row stays unprocessed and
   * the retry runs it again.
   */
  async handleWebhook(rawBody: Buffer | undefined, signature: string | undefined, eventIdHeader: string | undefined)
    : Promise<{ outcome: WebhookOutcome }> {
    if (!this.config.webhookSecret) throw new ServiceUnavailableException('Payments are not configured');
    if (!rawBody) {
      this.logger.error('Webhook raw body unavailable: create the Nest app with { rawBody: true }');
      throw new InternalServerErrorException('Webhook body unavailable');
    }
    if (!verifyWebhookSignature(rawBody, signature, this.config.webhookSecret)) {
      this.logger.warn('Rejected a Razorpay webhook with a missing or invalid signature');
      throw new BadRequestException('Invalid webhook signature');
    }
    let body: WebhookBody;
    try {
      body = JSON.parse(rawBody.toString('utf8')) as WebhookBody;
    } catch {
      throw new BadRequestException('Webhook body is not valid JSON');
    }
    const type = typeof body?.event === 'string' ? body.event.slice(0, 64) : '';
    if (!type) throw new BadRequestException('Webhook event type missing');

    const entityId = body.payload?.payment?.entity?.id ?? body.payload?.refund?.entity?.id
      ?? body.payload?.order?.entity?.id ?? '';
    const eventId = (eventIdHeader?.trim() || `${type}:${entityId}:${body.created_at ?? ''}`).slice(0, 200);

    const { rows: inserted } = await this.db.query<{ id: string }>(
      `INSERT INTO payment_events (provider, event_id, event_type, payload)
       VALUES ('razorpay', $1, $2, $3::jsonb)
       ON CONFLICT (event_id) DO NOTHING RETURNING id`,
      [eventId, type, JSON.stringify(redactPayload(body))],
    );
    if (!inserted.length) {
      const { rows: seen } = await this.db.query<{ processed_at: Date | null }>(
        `SELECT processed_at FROM payment_events WHERE event_id = $1`,
        [eventId],
      );
      if (seen[0]?.processed_at) return { outcome: 'duplicate' };
      // Seen but not finished (an earlier attempt crashed): run it again; handlers are idempotent.
    }

    try {
      const outcome = await this.dispatch(type, body);
      await this.finishEvent(eventId, null);
      this.logger.log(`Razorpay ${type} (${eventId}): ${outcome}`);
      return { outcome };
    } catch (err) {
      if (err instanceof HttpException && err.getStatus() < 500) {
        // A business refusal (e.g. a payment for a cancelled contract): retrying won't help.
        await this.finishEvent(eventId, err.message);
        this.logger.warn(`Razorpay ${type} (${eventId}) refused: ${err.message}`);
        return { outcome: 'refused' };
      }
      await this.db.query(
        `UPDATE payment_events SET error = $2 WHERE event_id = $1`,
        [eventId, describe(err).slice(0, 1000)],
      ).catch(() => undefined);
      this.logger.error(`Razorpay ${type} (${eventId}) failed: ${describe(err)}`);
      throw err instanceof HttpException ? err : new InternalServerErrorException('Webhook handling failed');
    }
  }

  private finishEvent(eventId: string, error: string | null) {
    return this.db.query(
      `UPDATE payment_events SET processed_at = NOW(), error = $2 WHERE event_id = $1`,
      [eventId, error ? error.slice(0, 1000) : null],
    );
  }

  private async dispatch(type: string, body: WebhookBody): Promise<WebhookOutcome> {
    const payment = body.payload?.payment?.entity;
    switch (type) {
      case 'payment.captured':
      case 'order.paid': {
        if (!payment?.id || !payment.order_id) return 'ignored';
        const order = await this.orderByProviderId(payment.order_id);
        if (!order) return 'ignored'; // not one of ours (e.g. a dashboard payment link)
        if (Number(payment.amount) !== Number(order.amount_minor) || payment.currency !== order.currency) {
          const reason = `Payment ${payment.id} (${Number(payment.amount) / 100} ${payment.currency}) does not match order ${order.provider_order_id}`;
          await this.markUnapplied(order, payment.id, reason, Number(payment.amount) || undefined, payment.currency);
          throw new BadRequestException(reason);
        }
        await this.capture(order, payment.id, 'razorpay:webhook');
        return 'processed';
      }
      case 'payment.authorized': {
        if (!payment?.order_id) return 'ignored';
        await this.db.query(
          `UPDATE payment_orders SET status = 'attempted', updated_at = NOW()
            WHERE provider_order_id = $1 AND status = 'created'`,
          [payment.order_id],
        );
        return 'processed';
      }
      case 'payment.failed': {
        // A failed attempt does not close a Razorpay order: the buyer can retry in the same
        // checkout. The order stays open (so openOrder reuses it, never a second order); only
        // the error text is kept.
        if (!payment?.order_id) return 'ignored';
        const { rows } = await this.db.query(
          `UPDATE payment_orders SET last_error = $2, updated_at = NOW()
            WHERE provider_order_id = $1 AND status IN ('created', 'attempted') RETURNING id`,
          [payment.order_id, (payment.error_description ?? 'Payment attempt failed').slice(0, 500)],
        );
        return rows.length ? 'processed' : 'ignored';
      }
      case 'refund.processed':
      case 'refund.failed': {
        const refund = body.payload?.refund?.entity;
        if (!refund?.id) return 'ignored';
        if (!this.refundHandler) throw new InternalServerErrorException('No refund handler registered');
        const notes = refund.notes && !Array.isArray(refund.notes) ? refund.notes : {};
        const refundId = typeof notes.refundId === 'string' && UUID_RE.test(notes.refundId) ? notes.refundId : undefined;
        await this.refundHandler({
          providerRefundId: refund.id,
          refundId,
          status: type === 'refund.processed' ? 'processed' : 'failed',
          error: type === 'refund.failed' ? 'Razorpay reported the refund as failed' : undefined,
          actor: 'razorpay:webhook',
        });
        return 'processed';
      }
      default:
        return 'ignored';
    }
  }

  // ─── Refunds ──────────────────────────────────────────────────────────────

  /**
   * One refund request to the provider; not retried. Throws PaymentProviderError: kind
   * 'rejected' means nothing was refunded, 'unavailable' means the outcome is unknown.
   */
  async refund(input: RefundInput): Promise<ProviderRefund> {
    this.assertConfigured();
    return this.provider!.refund(input);
  }
}

function describe(err: unknown): string {
  if (err instanceof PaymentProviderError) return `${err.kind}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}
