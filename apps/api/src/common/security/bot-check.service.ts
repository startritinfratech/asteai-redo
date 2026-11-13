import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { isDisposableEmail } from './disposable-email';

export const TURNSTILE_VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/** `drop`: a bot filled the honeypot. Answer 2xx as if accepted, but store and send nothing. */
export type BotVerdict = 'ok' | 'drop';

type FetchFn = (url: string, init: { method: string; body: URLSearchParams; signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

/**
 * Gate for public, unauthenticated writes (forms, sign-up codes):
 *  1. honeypot: a filled `website` field is a bot → `drop`;
 *  2. Cloudflare Turnstile token, verified server-side (skipped when no secret is configured,
 *     which env validation only allows outside production);
 *  3. throwaway email domains are refused with 400.
 */
@Injectable()
export class BotCheckService {
  private readonly logger = new Logger(BotCheckService.name);
  private readonly secret: string | undefined;
  private readonly fetchFn: FetchFn;

  constructor(config: ConfigService, fetchFn?: FetchFn) {
    this.secret = config.get<string>('TURNSTILE_SECRET_KEY') || undefined;
    this.fetchFn = fetchFn ?? (globalThis.fetch as unknown as FetchFn);
    if (!this.secret) this.logger.warn('TURNSTILE_SECRET_KEY is not set: public forms skip the Turnstile check');
  }

  async check(input: { website?: string; turnstileToken?: string; email?: string }, ip: string | null): Promise<BotVerdict> {
    if (input.website && input.website.trim() !== '') return 'drop';
    await this.verifyTurnstile(input.turnstileToken, ip);
    if (input.email && isDisposableEmail(input.email)) {
      throw new BadRequestException('Please use a permanent email address (temporary inboxes are not accepted).');
    }
    return 'ok';
  }

  /** Throws 400 when the token is missing or Cloudflare rejects it; 503 is never thrown (fail closed as 400). */
  async verifyTurnstile(token: string | undefined, ip: string | null): Promise<void> {
    if (!this.secret) return;
    if (!token) throw new BadRequestException('Please complete the security check.');
    const body = new URLSearchParams({ secret: this.secret, response: token });
    if (ip) body.set('remoteip', ip);
    let success = false;
    try {
      const res = await this.fetchFn(TURNSTILE_VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(5000) });
      const data = (res.ok ? await res.json() : null) as { success?: boolean; 'error-codes'?: string[] } | null;
      success = data?.success === true;
      if (!success) this.logger.warn(`Turnstile rejected a token: ${(data?.['error-codes'] ?? ['http-error']).join(',')}`);
    } catch (err) {
      this.logger.error(`Turnstile verification failed: ${err instanceof Error ? err.message : String(err)}`);
    }
    if (!success) throw new BadRequestException('The security check failed. Please try again.');
  }
}
