// ─── Account security ────────────────────────────────────────────────────────
// Shared by apps/api (modules/auth, modules/users) and apps/web (features/account).
// Type-only apart from the constants the API validates against.

import type { User } from './index';

/** Server rule for every password (register, reset, change). */
export const PASSWORD_MIN_LENGTH = 8;
export const PASSWORD_MAX_LENGTH = 256;

/** Number of digits in a TOTP code, and of one-time backup codes issued on enrolment. */
export const TOTP_DIGITS = 6;
export const BACKUP_CODE_COUNT = 10;

/** Tokens as AuthService issues them (server side only; never sent to the browser). */
export interface AuthTokensResponse {
  accessToken: string;
  refreshToken: string;
  user: User;
}

/**
 * What login, register, refresh, 2FA login and password change return to the browser.
 * The tokens themselves travel only as HttpOnly cookies.
 */
export interface SessionResponse {
  user: User;
  /** This session's id (the refresh-token row), to mark "this device" in the sessions list. */
  sessionId: string;
}

/** POST /auth/login when the account has two-factor authentication on. */
export interface TwoFactorChallengeResponse {
  twoFactorRequired: true;
  /** Signed, 5-minute token for POST /auth/login/2fa. It is not an access token. */
  challenge: string;
}

export type LoginResponse = SessionResponse | TwoFactorChallengeResponse;

export interface TwoFactorLoginRequest {
  challenge: string;
  code?: string;
  backupCode?: string;
}

/** GET /auth/2fa */
export interface TwoFactorStatus {
  enabled: boolean;
  enrolledAt: string | null;
  backupCodesRemaining: number;
}

/** POST /auth/2fa/setup: shown once while enrolling; nothing is enabled until /enable. */
export interface TwoFactorSetupResponse {
  /** Base32 secret for manual entry. */
  secret: string;
  /** otpauth://totp/... URI for authenticator apps (encode as a QR code). */
  otpauthUri: string;
}

/** POST /auth/2fa/enable: the backup codes are returned only this once. */
export interface TwoFactorEnableResponse {
  backupCodes: string[];
}

/** GET /auth/sessions: one signed-in device (an unrevoked, unexpired refresh token). */
export interface SessionInfo {
  /** The refresh token's row id: the part of the refresh token before the dot. */
  id: string;
  /** When the user signed in on this device. */
  createdAt: string;
  /** When the session's tokens were last issued or refreshed. */
  lastUsedAt: string;
  expiresAt: string;
  userAgent: string | null;
  ipAddress: string | null;
}
