'use client';

/**
 * Auth store (Zustand). Holds the signed-in user. The session itself lives in HttpOnly
 * cookies the page cannot read (see lib/tokens); `user` and `sessionId` are persisted so
 * a reload renders signed-in UI without a round trip.
 */
import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type {
  LoginResponse, SessionResponse, TwoFactorChallengeResponse, User, UserRole,
} from '@asteai/types';
import { mutate } from 'swr';
import { api, apiRequest, setSessionExpiredHandler } from '@/lib/api';
import { clearLegacyTokens, hasSessionHint } from '@/lib/tokens';

export interface RegisterPayload {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  role?: UserRole;
  /** From POST /auth/email/verify-otp: proves the address, so the account starts verified. */
  otpTicket?: string;
}

interface AuthState {
  user: User | null;
  /** This browser's session id (marks "this device" in the sessions list). */
  sessionId: string | null;
  isLoading: boolean;

  /**
   * Signs in with email and password. Returns the user, or the 2FA challenge when the
   * account has two-factor authentication on (then nothing is stored yet: finish with
   * POST /auth/login/2fa and `setSession`).
   */
  login: (email: string, password: string) => Promise<User | TwoFactorChallengeResponse>;
  /** Stores the user from any sign-in (login, register, 2FA, password change); the API set the cookies. */
  setSession: (res: SessionResponse) => User;
  register: (payload: RegisterPayload) => Promise<User>;
  logout: () => Promise<void>;
  /**
   * Re-reads the user from `/users/me`. Without the session hint cookie (anonymous visitor,
   * or the session ended) it makes no request at all and just clears any cached user.
   */
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
      sessionId: null,
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
        set({ user: res.user, sessionId: res.sessionId });
        return res.user;
      },

      async register(payload) {
        set({ isLoading: true });
        try {
          return get().setSession(await api.post<SessionResponse>('/auth/register', payload));
        } finally {
          set({ isLoading: false });
        }
      },

      async logout() {
        // Sign out locally first so nothing (a slow network) can leave the user half signed in.
        set({ user: null, sessionId: null });
        clearSwrCache();
        // The API revokes the session from its cookies (or the access token) and clears them.
        try {
          await apiRequest('/auth/logout', { method: 'POST', body: {} });
        } catch {
          // The server session may already be gone; the local sign-out above stands.
        }
      },

      async refreshUser() {
        if (!hasSessionHint()) {
          if (get().user) set({ user: null, sessionId: null });
          return;
        }
        try {
          set({ user: await api.get<User>('/users/me') });
        } catch {
          // Leave the cached user; a 401 is handled by the session-expired handler.
        }
      },

      clearSession() {
        set({ user: null, sessionId: null });
        clearSwrCache();
      },
    }),
    {
      name: 'asteai-auth',
      partialize: (s) => ({ user: s.user, sessionId: s.sessionId }),
      onRehydrateStorage: () => (state) => {
        clearLegacyTokens();
        // Cached user but no session cookie any more (expired, or signed out in another
        // tab): drop it without asking the API.
        if (state?.user && !hasSessionHint()) state.clearSession();
      },
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
