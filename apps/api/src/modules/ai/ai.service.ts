import { Injectable, Logger, BadGatewayException, HttpException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { User } from '@asteai/types';

/** What deeptech_ai reads from a bearer token (its verify_token / _extract_* helpers). */
interface AiTokenClaims {
  user_id: string;
  id: string;
  email: string;
  name: string;
  purpose: 'asteai';
}

export interface AiSession {
  /** Base URL of deeptech_ai as the browser reaches it, e.g. https://ai.asteai.com */
  baseUrl: string;
  /** Short-lived token the browser sends to deeptech_ai (WebSocket subprotocol / bearer). */
  token: string;
  expiresInSeconds: number;
}

/**
 * Talks to deeptech_ai.
 *
 * The AI service verifies bearer tokens with its own HS256 secret and reads `user_id`.
 * This API's access tokens are signed with JWT_SECRET and carry `sub`, and handing
 * JWT_SECRET to another service would let it mint platform logins. So the platform
 * signs a separate short-lived token with AI_JWT_SECRET (= deeptech_ai's JWT_SECRET)
 * that only the AI service accepts.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger(AiService.name);
  private readonly baseUrl: string;
  private readonly publicUrl: string;
  private readonly apiKey: string;
  private readonly tokenSecret: string;
  private readonly tokenTtl: number;

  constructor(config: ConfigService, private readonly jwt: JwtService) {
    this.baseUrl = (config.get<string>('AI_SERVICE_URL') ?? 'http://localhost:8000').replace(/\/$/, '');
    this.publicUrl = (config.get<string>('AI_SERVICE_PUBLIC_URL') ?? this.baseUrl).replace(/\/$/, '');
    this.apiKey = config.get<string>('AI_SERVICE_API_KEY') ?? '';
    this.tokenSecret = config.get<string>('AI_JWT_SECRET') ?? '';
    // Long enough for Part 1 plus a 15-minute interview and its finalisation; the
    // WebSocket is authenticated once, at the handshake.
    this.tokenTtl = Number(config.get('AI_TOKEN_TTL_SECONDS') ?? 1800);
  }

  session(user: Pick<User, 'id' | 'email' | 'firstName' | 'lastName'>): AiSession {
    if (!this.tokenSecret) {
      throw new HttpException('AI interviews are not configured (AI_JWT_SECRET is not set)', 503);
    }
    const claims: AiTokenClaims = {
      user_id: user.id,
      id: user.id,
      email: user.email,
      name: [user.firstName, user.lastName].filter(Boolean).join(' '),
      purpose: 'asteai',
    };
    const token = this.jwt.sign(claims, {
      secret: this.tokenSecret,
      algorithm: 'HS256',
      expiresIn: this.tokenTtl,
    });
    return { baseUrl: this.publicUrl, token, expiresInSeconds: this.tokenTtl };
  }

  /**
   * POST to deeptech_ai. `userToken` is an AI session token when the endpoint wants
   * the user (e.g. /mock-interview/start); the API key is always sent.
   */
  post<T>(path: string, body: unknown, userToken?: string, timeoutMs = 30_000): Promise<T> {
    return this.request<T>('POST', path, body, userToken, timeoutMs);
  }

  /** GET from deeptech_ai with the service API key. */
  get<T>(path: string, timeoutMs = 30_000): Promise<T> {
    return this.request<T>('GET', path, undefined, undefined, timeoutMs);
  }

  private async request<T>(
    method: 'GET' | 'POST', path: string, body: unknown, userToken: string | undefined, timeoutMs: number,
  ): Promise<T> {
    const headers: Record<string, string> = { 'x-api-key': this.apiKey };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (userToken) headers.Authorization = `Bearer ${userToken}`;

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      this.logger.error(`AI service unreachable on ${path}: ${err instanceof Error ? err.message : err}`);
      throw new BadGatewayException('The AI interview service is unreachable');
    }

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      if (res.status === 401 || res.status === 403) {
        this.logger.error(
          `AI service refused ${path} (${res.status}). Check AI_SERVICE_API_KEY matches deeptech_ai ` +
            `AI_API_KEY and AI_JWT_SECRET matches its JWT_SECRET. ${text.slice(0, 200)}`,
        );
      } else {
        this.logger.error(`AI service ${path} returned ${res.status}: ${text.slice(0, 300)}`);
      }
      throw Object.assign(new BadGatewayException(`AI service error (${res.status})`), {
        aiStatus: res.status,
        aiBody: text,
      });
    }
    return (await res.json()) as T;
  }
}
