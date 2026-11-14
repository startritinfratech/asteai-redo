/**
 * Account-security API calls (password reset/change, email verification, 2FA, sessions,
 * account deletion). Sessions they start or rotate (the 2FA step, a password change) are
 * handed to the auth store's `setSession`.
 */
import type { User } from '@asteai/types';
import { api, apiRequest } from '@/lib/api';
import { useAuthStore } from '@/store/auth';
import type {
  SessionInfo, SessionResponse, TwoFactorChallengeResponse, TwoFactorEnableResponse, TwoFactorSetupResponse,
  TwoFactorStatus,
} from './types';

/** True for the 2FA challenge that POST /auth/login (and the store's `login()`) returns. */
export const isTwoFactorChallenge = (res: object): res is TwoFactorChallengeResponse =>
  'twoFactorRequired' in res && res.twoFactorRequired === true;

/** The refresh-token row id of this browser's session (returned by every sign-in). */
export function currentSessionId(): string | null {
  return useAuthStore.getState().sessionId;
}

// ── Sign-in ───────────────────────────────────────────────────────────────────

export const loginSecondFactor = (challenge: string, factor: { code: string } | { backupCode: string }) =>
  api.post<SessionResponse>('/auth/login/2fa', { challenge, ...factor });

// ── Password ──────────────────────────────────────────────────────────────────

/** Always succeeds for a well-formed address: the API never says whether the account exists. */
export const requestPasswordReset = (email: string) => api.post<void>('/auth/password/forgot', { email });

export const resetPassword = (token: string, password: string) =>
  api.post<void>('/auth/password/reset', { token, password });

export async function changePassword(currentPassword: string, newPassword: string): Promise<User> {
  const res = await api.post<SessionResponse>('/auth/password/change', { currentPassword, newPassword });
  return useAuthStore.getState().setSession(res);
}

// ── Email verification ────────────────────────────────────────────────────────

export const verifyEmail = (token: string) => api.post<void>('/auth/verify-email', { token });
export const sendVerificationEmail = () => api.post<void>('/auth/verify-email/send');

// ── Two-factor ────────────────────────────────────────────────────────────────

export const TWO_FACTOR_KEY = '/auth/2fa';
export const twoFactorStatus = () => api.get<TwoFactorStatus>('/auth/2fa');
export const startTwoFactorSetup = () => api.post<TwoFactorSetupResponse>('/auth/2fa/setup');
export const enableTwoFactor = (code: string) =>
  api.post<TwoFactorEnableResponse>('/auth/2fa/enable', { code });
export const disableTwoFactor = (password: string, factor: { code: string } | { backupCode: string }) =>
  api.post<void>('/auth/2fa/disable', { password, ...factor });

// ── Sessions ──────────────────────────────────────────────────────────────────

export const SESSIONS_KEY = '/auth/sessions';
export const listSessions = () => api.get<SessionInfo[]>('/auth/sessions');
export const revokeSession = (id: string) =>
  api.delete<void>(`/auth/sessions/${encodeURIComponent(id)}`);
export type { SessionInfo };

// ── Account deletion ──────────────────────────────────────────────────────────

export async function deleteAccount(password: string): Promise<void> {
  await apiRequest('/users/me', { method: 'DELETE', body: { password } });
  useAuthStore.getState().clearSession();
}

