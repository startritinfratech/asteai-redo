'use client';

/**
 * Auth store (Zustand). Holds the signed-in user; tokens live in lib/tokens.
 * Only `user` is persisted, so a reload keeps the session without a round trip.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  AuthTokensResponse, LoginResponse, TwoFactorChallengeResponse, User, UserRole,
} from '@asteai/types';
import { mutate } from 'swr';
import { api, apiRequest, setSessionExpiredHandler } from '@/lib/api';
import { tokenStorage } from '@/lib/tokens';

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
}

interface AuthState {
  user: User | null;
  isLoading: boolean;

  /**
   * Signs in with email and password. Returns the user, or the 2FA challenge when the
   * account has two-factor authentication on (then nothing is stored yet: finish with
   * POST /auth/login/2fa and `setSession`).
   */
  login: (email: string, password: string) => Promise<User | TwoFactorChallengeResponse>;
  /** Stores the tokens and user from any sign-in (login, register, 2FA, password change). */
  setSession: (res: AuthTokensResponse) => User;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  refreshUser: () => Promise<void>;
  clearSession: () => void;
}

/** Drops every cached SWR response so the next user never sees the previous user's data. */
function clearSwrCache() {
  void mutate(() => true, undefined, { revalidate: false });
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      user: null,
      isLoading: false,

      async login(email, password) {
        set({ isLoading: true });
        try {
          const res = await api.post<LoginResponse>('/auth/login', { email, password });
          // Password accepted but a second factor is due: nothing is stored yet.
          if ('twoFactorRequired' in res) return res;
          return get().setSession(res);
        } finally {
          set({ isLoading: false });
        }
      },

      setSession(res) {
        tokenStorage.set({ accessToken: res.accessToken, refreshToken: res.refreshToken, userId: res.user.id });
        set({ user: res.user });
        return res.user;
      },

      async register(payload) {
        set({ isLoading: true });
        try {
          return get().setSession(await api.post<AuthTokensResponse>('/auth/register', payload));
        } finally {
          set({ isLoading: false });
        }
      },

      async logout() {
        // Snapshot the tokens, then sign out locally first so nothing (an expired
        // access token, a slow network) can leave the user half signed in.
        const { accessToken, refreshToken, userId } = tokenStorage.get();
        tokenStorage.clear();
        set({ user: null });
        clearSwrCache();

        // The API revokes refresh tokens with either the bearer token or, after the
        // access token has expired, the {userId, refreshToken} pair in the body.
        if (!userId && !accessToken) return;
        try {
          await apiRequest('/auth/logout', {
            method: 'POST',
            body: userId && refreshToken ? { userId, refreshToken } : {},
            headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : undefined,
          });
        } catch {
          // The server session may already be gone; the local sign-out above stands.
        }
      },

      async refreshUser() {
        try {
          set({ user: await api.get<User>('/users/me') });
        } catch {
          // Leave the cached user; a 401 is handled by the session-expired handler.
        }
      },

      clearSession() {
        tokenStorage.clear();
        set({ user: null });
        clearSwrCache();
      },
    }),
    {
      name: 'asteai-auth',
      partialize: (s) => ({ user: s.user }),
    },
  ),
);

/**
 * False during server render and the first client render, true once the persisted
 * user has been read. Gate anything that depends on `user` on it to avoid hydration
 * mismatches and premature redirects.
 */
export function useAuthHydrated(): boolean {
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    const unsub = useAuthStore.persist.onFinishHydration(() => setHydrated(true));
    if (useAuthStore.persist.hasHydrated()) setHydrated(true);
    return unsub;
  }, []);
  return hydrated;
}

// When a refresh fails, drop the cached user so the shell's guard sends the user to sign in.
setSessionExpiredHandler(() => useAuthStore.getState().clearSession());
