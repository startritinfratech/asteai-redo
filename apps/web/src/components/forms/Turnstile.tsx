'use client';

/**
 * Cloudflare Turnstile widget for public forms. With NEXT_PUBLIC_TURNSTILE_SITE_KEY unset
 * (development) it renders nothing and reports an empty token: the API skips the check when
 * it has no secret either. The script loads once, on first use, in explicit-render mode.
 */
import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react';

const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
export const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ?? '';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let scriptPromise: Promise<TurnstileApi> | null = null;
function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile failed to load')));
    s.onerror = () => { scriptPromise = null; reject(new Error('Turnstile failed to load')); };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export interface TurnstileHandle {
  /** Get a fresh token after a failed submit (tokens are single-use). */
  reset: () => void;
}

export const Turnstile = forwardRef<TurnstileHandle, {
  onToken: (token: string) => void;
  action?: string;
}>(function Turnstile({ onToken, action }, ref) {
  const box = useRef<HTMLDivElement>(null);
  const widget = useRef<string | null>(null);
  const tokenCb = useRef(onToken);
  tokenCb.current = onToken;

  useImperativeHandle(ref, () => ({
    reset: () => {
      if (widget.current && window.turnstile) {
        tokenCb.current('');
        window.turnstile.reset(widget.current);
      }
    },
  }), []);

  useEffect(() => {
    if (!TURNSTILE_SITE_KEY) return;
    let cancelled = false;
    loadTurnstile()
      .then((ts) => {
        if (cancelled || !box.current) return;
        widget.current = ts.render(box.current, {
          sitekey: TURNSTILE_SITE_KEY,
          action,
          theme: document.documentElement.dataset.theme === 'light' ? 'light' : 'dark',
          callback: (t: string) => tokenCb.current(t),
          'expired-callback': () => tokenCb.current(''),
          'error-callback': () => tokenCb.current(''),
        });
      })
      .catch(() => tokenCb.current(''));
    return () => {
      cancelled = true;
      if (widget.current && window.turnstile) window.turnstile.remove(widget.current);
      widget.current = null;
    };
  }, [action]);

  if (!TURNSTILE_SITE_KEY) return null;
  return <div ref={box} style={{ minHeight: 65 }} />;
});

/** Whether a form must wait for a token before submitting. */
export const turnstileRequired = () => Boolean(TURNSTILE_SITE_KEY);
