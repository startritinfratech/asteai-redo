/**
 * Test doubles shared by the Phase 2 specs (marketing, public, products, support, OTP):
 * a pg pool that answers by matching SQL, and recorders for email / bot checks.
 */
import type { Pool } from 'pg';
import type { ConfigService } from '@nestjs/config';
import type { EmailService } from '../modules/email/email.service';
import type { BotCheckService, BotVerdict } from '../common/security/bot-check.service';

type Rows = unknown[];
export type Route = [RegExp, Rows | ((params: unknown[]) => Rows | { error: unknown })];

/** A pool that answers by matching the SQL against routes (first match wins) and records every statement. */
export function fakeDb(routes: Route[]) {
  const log: { sql: string; params: unknown[] }[] = [];
  const query = async (text: string, params: unknown[] = []) => {
    log.push({ sql: text, params });
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    for (const [re, reply] of routes) {
      if (re.test(text)) {
        const out = typeof reply === 'function' ? reply(params) : reply;
        if (!Array.isArray(out)) throw (out as { error: unknown }).error;
        return { rows: out, rowCount: out.length };
      }
    }
    return { rows: [], rowCount: 0 };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  const all = (re: RegExp) => log.filter((q) => re.test(q.sql));
  const tx = () => log.filter((q) => /^(BEGIN|COMMIT|ROLLBACK)$/.test(q.sql)).map((q) => q.sql);
  return { pool, log, all, tx };
}

export function fakeEmail() {
  const queued: { template: string; to: string; data: Record<string, unknown>; inTx: boolean }[] = [];
  const svc = {
    enqueue: async (template: string, to: string, data: Record<string, unknown>, opts: { client?: unknown } = {}) => {
      queued.push({ template, to, data, inTx: Boolean(opts.client) });
      return 'mail-id';
    },
  } as unknown as EmailService;
  return { svc, queued };
}

export function fakeBots(verdict: BotVerdict | Error = 'ok') {
  const calls: { input: Record<string, unknown>; ip: string | null }[] = [];
  const svc = {
    check: async (input: Record<string, unknown>, ip: string | null) => {
      calls.push({ input, ip });
      if (verdict instanceof Error) throw verdict;
      return verdict;
    },
    verifyTurnstile: async () => {
      if (verdict instanceof Error) throw verdict;
    },
  } as unknown as BotCheckService;
  return { svc, calls };
}

export const fakeConfig = (values: Record<string, string | undefined> = {}) =>
  ({ get: (key: string, fallback?: unknown) => values[key] ?? fallback, getOrThrow: (key: string) => values[key] }) as unknown as ConfigService;
