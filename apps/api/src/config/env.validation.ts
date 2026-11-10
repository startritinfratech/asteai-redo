import 'reflect-metadata';
import { Type, plainToInstance } from 'class-transformer';
import {
  IsIn, IsInt, IsOptional, IsString, IsUrl, Max, Min, MinLength, ValidateIf, validateSync,
} from 'class-validator';

/**
 * Environment the API needs, checked once at boot (ConfigModule `validate`), so a
 * missing or malformed variable stops startup with a list of problems instead of
 * failing on the first request that reads it.
 *
 * Variables not listed here are passed through untouched.
 */
class EnvironmentVariables {
  @IsOptional() @IsIn(['development', 'production', 'test'])
  NODE_ENV?: string;

  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535)
  PORT?: number;

  /**
   * How many reverse proxies (load balancer, CDN) sit in front of the API. Express then
   * takes the client IP (req.ip, e.g. contract signature IPs) from X-Forwarded-For that
   * many hops back. Unset or 0: trust no proxy and use the socket address.
   */
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) @Max(10)
  TRUST_PROXY?: number;

  // ── Database ──
  @IsString() DATABASE_HOST: string;
  @IsString() DATABASE_NAME: string;
  @IsString() DATABASE_USER: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(65535) DATABASE_PORT?: number;
  @IsOptional() @IsIn(['true', 'false']) DATABASE_IAM_AUTH?: string;
  @IsOptional() @IsIn(['true', 'false']) DATABASE_SSL?: string;
  @IsOptional() @IsIn(['true', 'false']) DATABASE_SSL_REJECT_UNAUTHORIZED?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) DATABASE_MAX_POOL?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) DATABASE_IDLE_TIMEOUT_MS?: number;
  @IsOptional() @Type(() => Number) @IsInt() @Min(0) DATABASE_CONNECT_TIMEOUT_MS?: number;

  /** Static password; not used with RDS IAM auth. */
  @ValidateIf((env: EnvironmentVariables) => env.DATABASE_IAM_AUTH !== 'true')
  @IsString() @MinLength(1, { message: 'DATABASE_PASSWORD is required unless DATABASE_IAM_AUTH=true' })
  DATABASE_PASSWORD?: string;

  /** Signs IAM auth tokens and is the SES region. */
  @ValidateIf((env: EnvironmentVariables) => env.DATABASE_IAM_AUTH === 'true' || env.EMAIL_TRANSPORT === 'ses')
  @IsString({ message: 'AWS_REGION is required when DATABASE_IAM_AUTH=true or EMAIL_TRANSPORT=ses' })
  AWS_REGION?: string;

  // ── Email ──
  @IsOptional() @IsIn(['ses', 'log']) EMAIL_TRANSPORT?: string;

  @ValidateIf((env: EnvironmentVariables) => env.EMAIL_TRANSPORT === 'ses')
  @IsString({ message: 'EMAIL_FROM is required when EMAIL_TRANSPORT=ses' })
  EMAIL_FROM?: string;

  @IsOptional() @IsIn(['true', 'false']) EMAIL_WORKER_ENABLED?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(500) EMAIL_POLL_MS?: number;

  // ── Auth ──
  @IsString() @MinLength(32, { message: 'JWT_SECRET must be at least 32 characters' })
  JWT_SECRET: string;

  @IsOptional() @IsString() JWT_EXPIRES_IN?: string;
  @IsOptional() @IsString() JWT_REFRESH_EXPIRES_IN?: string;

  /**
   * AES-256-GCM key material for stored TOTP secrets. Required in production; in
   * development the key is derived from JWT_SECRET when it is unset.
   */
  @ValidateIf((env: EnvironmentVariables) => env.NODE_ENV === 'production' || env.TOTP_ENCRYPTION_KEY !== undefined)
  @IsString({ message: 'TOTP_ENCRYPTION_KEY is required in production' })
  @MinLength(32, { message: 'TOTP_ENCRYPTION_KEY must be at least 32 characters' })
  TOTP_ENCRYPTION_KEY?: string;

  // ── AI service ──
  @IsOptional() @IsUrl({ require_tld: false }) AI_SERVICE_URL?: string;
  @IsOptional() @IsUrl({ require_tld: false }) AI_SERVICE_PUBLIC_URL?: string;
  @IsOptional() @IsString() @MinLength(32, { message: 'AI_JWT_SECRET must be at least 32 characters' })
  AI_JWT_SECRET?: string;
  @IsOptional() @Type(() => Number) @IsInt() @Min(60) AI_TOKEN_TTL_SECONDS?: number;

  @IsOptional() @IsUrl({ require_tld: false }) PUBLIC_WEB_URL?: string;
}

/** Empty strings in .env files mean "not set". */
function dropEmpty(config: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(config).filter(([, v]) => v !== ''));
}

export function validateEnv(config: Record<string, unknown>): Record<string, unknown> {
  const env = plainToInstance(EnvironmentVariables, dropEmpty(config));
  const problems = validateSync(env, { skipMissingProperties: false }).flatMap((e) => Object.values(e.constraints ?? {}));

  if (env.AI_JWT_SECRET && env.AI_JWT_SECRET === env.JWT_SECRET) {
    problems.push('AI_JWT_SECRET must differ from JWT_SECRET (the AI service must not be able to mint logins)');
  }
  if (env.TOTP_ENCRYPTION_KEY && env.TOTP_ENCRYPTION_KEY === env.JWT_SECRET) {
    problems.push('TOTP_ENCRYPTION_KEY must differ from JWT_SECRET');
  }
  if (env.NODE_ENV === 'production' && /^replace_with/.test(env.JWT_SECRET ?? '')) {
    problems.push('JWT_SECRET still has the .env.example placeholder');
  }

  if (problems.length) {
    throw new Error(`Invalid environment:\n  - ${problems.join('\n  - ')}`);
  }
  // Return the original strings: the rest of the app reads them via ConfigService as before.
  return config;
}
