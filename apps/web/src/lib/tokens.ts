/**
 * The single place auth tokens live in the browser. Everything else (the API client,
 * the auth store, file downloads) reads and writes them through here.
 */
const KEYS = { access: 'accessToken', refresh: 'refreshToken', userId: 'userId' } as const;

const hasStorage = () => typeof window !== 'undefined' && typeof window.localStorage !== 'undefined';

function read(key: string): string | null {
  if (!hasStorage()) return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export interface StoredTokens {
  accessToken: string | null;
  refreshToken: string | null;
  userId: string | null;
}

export const tokenStorage = {
  get(): StoredTokens {
    return { accessToken: read(KEYS.access), refreshToken: read(KEYS.refresh), userId: read(KEYS.userId) };
  },

  getAccessToken: () => read(KEYS.access),

  set(tokens: { accessToken: string; refreshToken: string; userId?: string }) {
    if (!hasStorage()) return;
    localStorage.setItem(KEYS.access, tokens.accessToken);
    localStorage.setItem(KEYS.refresh, tokens.refreshToken);
    if (tokens.userId) localStorage.setItem(KEYS.userId, tokens.userId);
  },

  clear() {
    if (!hasStorage()) return;
    Object.values(KEYS).forEach((k) => localStorage.removeItem(k));
  },
};
