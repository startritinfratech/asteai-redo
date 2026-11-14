/** Pure outreach helpers (outreach.spec.ts): templating, pacing and unsubscribe tokens. */
import { createHmac, timingSafeEqual } from 'crypto';
import { OUTREACH_VARIABLES, type OutreachVariable } from '@asteai/types';

const VAR = /\{\{\s*([a-zA-Z]+)\s*\}\}/g;

/** Variables a template uses that aren't allowed (e.g. typos like {{firstname}}). */
export function unknownVariables(template: string): string[] {
  const out = new Set<string>();
  for (const m of template.matchAll(VAR)) {
    if (!(OUTREACH_VARIABLES as readonly string[]).includes(m[1])) out.add(m[1]);
  }
  return [...out];
}

/** Fills {{variables}} as plain text (the email layout escapes HTML). Missing values become ''. */
export function renderTemplate(template: string, vars: Partial<Record<OutreachVariable, string>>): string {
  return template
    .replace(VAR, (_m, name: string) => (vars[name as OutreachVariable] ?? '').replace(/[\r\n]+/g, ' '))
    .replace(/[ \t]{2,}/g, ' ');
}

export const firstNameOf = (fullName: string) => fullName.trim().split(/\s+/)[0] ?? '';

/**
 * When the i-th message (0-based) may be released: evenly spread at `ratePerMinute`, so a
 * campaign never goes out faster than its rate however far behind the dispatcher is.
 */
export function sendAfter(start: Date, index: number, ratePerMinute: number): Date {
  return new Date(start.getTime() + Math.floor((index * 60_000) / ratePerMinute));
}

/** Signed `<payload>.<mac>` for the unsubscribe link: no lookup table, can't be forged. */
export function unsubscribeToken(secret: string, tenantId: string, email: string): string {
  const payload = Buffer.from(JSON.stringify({ t: tenantId, e: email.toLowerCase() })).toString('base64url');
  const mac = createHmac('sha256', secret).update(payload).digest('base64url');
  return `${payload}.${mac}`;
}

export function readUnsubscribeToken(secret: string, token: string): { tenantId: string; email: string } | null {
  const [payload, mac] = (token ?? '').split('.');
  if (!payload || !mac || token.length > 1000) return null;
  const want = Buffer.from(createHmac('sha256', secret).update(payload).digest('base64url'));
  const got = Buffer.from(mac);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const { t, e } = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { t?: unknown; e?: unknown };
    return typeof t === 'string' && typeof e === 'string' ? { tenantId: t, email: e } : null;
  } catch {
    return null;
  }
}
