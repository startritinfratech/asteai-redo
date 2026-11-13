/**
 * Browser cookie-consent state (the site banner / consent-preferences page). Separate from
 * the account consent log in ./consents.ts, which records legal consents per user.
 *
 * Stored as the `asteai_consent` cookie so it is readable before any script loads.
 */
export const CONSENT_COOKIE = 'asteai_consent';
export const CONSENT_VERSION = 1;
const ONE_YEAR_S = 365 * 24 * 60 * 60;

export const OPTIONAL_CATEGORIES = ['functional', 'analytics', 'marketing'] as const;
export type OptionalCategory = (typeof OPTIONAL_CATEGORIES)[number];

export interface ConsentState {
  v: number;
  functional: boolean;
  analytics: boolean;
  marketing: boolean;
  /** ISO time the choice was made. */
  ts: string;
}

export const ALL_DENIED: Omit<ConsentState, 'ts'> = { v: CONSENT_VERSION, functional: false, analytics: false, marketing: false };
export const ALL_GRANTED: Omit<ConsentState, 'ts'> = { v: CONSENT_VERSION, functional: true, analytics: true, marketing: true };

/** Parses a `document.cookie` string. Unknown versions or malformed values count as "no choice yet". */
export function parseConsentCookie(cookieHeader: string): ConsentState | null {
  const raw = cookieHeader
    .split(';')
    .map((c) => c.trim())
    .find((c) => c.startsWith(`${CONSENT_COOKIE}=`));
  if (!raw) return null;
  try {
    const value = JSON.parse(decodeURIComponent(raw.slice(CONSENT_COOKIE.length + 1))) as Partial<ConsentState>;
    if (value.v !== CONSENT_VERSION) return null;
    return {
      v: CONSENT_VERSION,
      functional: value.functional === true,
      analytics: value.analytics === true,
      marketing: value.marketing === true,
      ts: typeof value.ts === 'string' ? value.ts : '',
    };
  } catch {
    return null;
  }
}

/**
 * Applies Global Privacy Control: a GPC signal is an opt-out of sale/sharing, so marketing
 * stays off whatever the stored or requested choice says.
 */
export function withGpc<T extends Omit<ConsentState, 'ts'>>(state: T, gpc: boolean): T {
  return gpc ? { ...state, marketing: false } : state;
}

export function serializeConsentCookie(state: ConsentState, secure: boolean): string {
  const value = encodeURIComponent(JSON.stringify(state));
  return `${CONSENT_COOKIE}=${value}; Path=/; Max-Age=${ONE_YEAR_S}; SameSite=Lax${secure ? '; Secure' : ''}`;
}

/** Browser-only: whether the visitor's browser sends Global Privacy Control. */
export function browserGpc(): boolean {
  return typeof navigator !== 'undefined' && (navigator as Navigator & { globalPrivacyControl?: boolean }).globalPrivacyControl === true;
}

/** Browser-only: persists a choice and notifies listeners (analytics loaders) in this tab. */
export function saveConsent(choice: Omit<ConsentState, 'v' | 'ts'>): ConsentState {
  const state = withGpc({ v: CONSENT_VERSION, ...choice, ts: new Date().toISOString() }, browserGpc());
  document.cookie = serializeConsentCookie(state, location.protocol === 'https:');
  window.dispatchEvent(new CustomEvent('asteai:consent', { detail: state }));
  return state;
}
