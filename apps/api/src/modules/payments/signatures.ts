import { createHmac, timingSafeEqual } from 'crypto';

/**
 * Razorpay signatures are lowercase hex HMAC-SHA256. Compared with crypto.timingSafeEqual
 * (AUDIT-30); a value of the wrong length is compared against itself first so the time
 * taken does not depend on where it differs, and is then rejected.
 */
export function hmacSha256Hex(secret: string, data: string | Buffer): string {
  return createHmac('sha256', secret).update(data).digest('hex');
}

export function safeEqualHex(expected: string, actual: unknown): boolean {
  if (typeof actual !== 'string') return false;
  const want = Buffer.from(expected, 'utf8');
  const got = Buffer.from(actual.trim().toLowerCase(), 'utf8');
  if (got.length !== want.length) {
    timingSafeEqual(want, want);
    return false;
  }
  return timingSafeEqual(want, got);
}

/** Checkout success: HMAC-SHA256(`${orderId}|${paymentId}`, key secret). */
export function verifyCheckoutSignature(orderId: string, paymentId: string, signature: unknown, keySecret: string): boolean {
  if (!keySecret || !orderId || !paymentId) return false;
  return safeEqualHex(hmacSha256Hex(keySecret, `${orderId}|${paymentId}`), signature);
}

/** Webhook: HMAC-SHA256 of the exact request bytes with the webhook secret. */
export function verifyWebhookSignature(rawBody: Buffer, signature: unknown, webhookSecret: string): boolean {
  if (!webhookSecret || !rawBody.length) return false;
  return safeEqualHex(hmacSha256Hex(webhookSecret, rawBody), signature);
}
