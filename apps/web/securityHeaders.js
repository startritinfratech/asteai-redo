/**
 * Response security headers for every page (wired in next.config.js `headers()`).
 *
 * CSP trade-off: Next's App Router streams inline <script> chunks, and the theme script is
 * inline too. A nonce would cover them, but reading a per-request nonce forces every page to
 * render dynamically, losing static generation for the whole marketing site. So scripts allow
 * 'unsafe-inline' from our own origin, while everything that limits what an injected script
 * could do is strict: no eval (outside dev), no plugins, no framing, no foreign forms, and
 * network access only to the API and the few third parties we actually use.
 *
 * Kept in plain CommonJS so next.config.js can require it and the spec can test it.
 */

const THIRD_PARTY = {
  turnstile: 'https://challenges.cloudflare.com',
  razorpayCheckout: 'https://checkout.razorpay.com',
  razorpayApi: 'https://api.razorpay.com',
  razorpayLog: 'https://lumberjack.razorpay.com',
};

/** "https://api.x.com/api/v1" → "https://api.x.com"; null for missing or relative values. */
function originOf(url) {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The websocket origin for an http(s) origin (socket.io may use either scheme). */
function wsOriginOf(origin) {
  return origin ? origin.replace(/^http/, 'ws') : null;
}

/**
 * @param {{ apiUrl?: string, wsUrl?: string, dev?: boolean }} opts
 * @returns {string}
 */
function buildCsp({ apiUrl, wsUrl, dev = false } = {}) {
  const api = originOf(apiUrl);
  const ws = originOf(wsUrl) ?? api;
  const connect = new Set(["'self'", THIRD_PARTY.turnstile, THIRD_PARTY.razorpayApi, THIRD_PARTY.razorpayLog]);
  for (const o of [api, ws, wsOriginOf(ws)]) if (o) connect.add(o);

  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", "'unsafe-inline'", ...(dev ? ["'unsafe-eval'"] : []), THIRD_PARTY.turnstile, THIRD_PARTY.razorpayCheckout],
    'style-src': ["'self'", "'unsafe-inline'"],
    'img-src': ["'self'", 'data:', 'blob:', 'https:'],
    'font-src': ["'self'", 'data:'],
    'media-src': ["'self'", 'blob:'],
    'connect-src': [...connect],
    'frame-src': [THIRD_PARTY.turnstile, THIRD_PARTY.razorpayApi, THIRD_PARTY.razorpayCheckout],
    'worker-src': ["'self'", 'blob:'],
    'object-src': ["'none'"],
    'base-uri': ["'self'"],
    'form-action': ["'self'"],
    'frame-ancestors': ["'none'"],
  };
  const parts = Object.entries(directives).map(([k, v]) => `${k} ${v.join(' ')}`);
  if (!dev) parts.push('upgrade-insecure-requests');
  return parts.join('; ');
}

/**
 * @param {{ apiUrl?: string, wsUrl?: string, dev?: boolean }} opts
 * @returns {{ key: string, value: string }[]}
 */
function buildSecurityHeaders(opts = {}) {
  const headers = [
    { key: 'Content-Security-Policy', value: buildCsp(opts) },
    { key: 'X-Content-Type-Options', value: 'nosniff' },
    { key: 'X-Frame-Options', value: 'DENY' },
    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
    // Camera + microphone are used by AI interviews on our own pages only.
    { key: 'Permissions-Policy', value: 'camera=(self), microphone=(self), geolocation=(), browsing-topics=(), payment=(self)' },
    { key: 'Cross-Origin-Opener-Policy', value: 'same-origin-allow-popups' },
  ];
  // HSTS only in production: on localhost it would pin the browser to https for the host.
  if (!opts.dev) headers.push({ key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' });
  return headers;
}

module.exports = { buildCsp, buildSecurityHeaders, originOf, THIRD_PARTY };
