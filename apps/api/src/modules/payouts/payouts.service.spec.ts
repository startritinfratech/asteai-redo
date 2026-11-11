import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import { deriveKey } from '../auth/totp';
import type { EmailService } from '../email/email.service';
import { LedgerService } from '../ledger/ledger.service';
import type { NotificationsService } from '../notifications/notifications.service';
import { maskAccount, maskUpi, openDetails, parsePayoutAccount, sealDetails } from './payout-account';
import { PayoutsService } from './payouts.service';

const status = (code: number) => (e: HttpException) => e.getStatus() === code;
const uniqueViolation = Object.assign(new Error('duplicate key'), { code: '23505' });

const expert = { id: 'exp-1', role: 'Freelancer', firstName: 'Eshan' } as User;
const admin = { id: 'adm-1', role: 'Admin', firstName: 'Ada', lastName: 'Admin' } as User;
const KEY = deriveKey('k'.repeat(40), 'payout-details-v1');
const PID = '22222222-2222-4222-8222-222222222222';

function fakeConfig(env: Record<string, string> = {}) {
  const all: Record<string, string> = { JWT_SECRET: 'j'.repeat(40), PAYOUT_ENCRYPTION_KEY: 'k'.repeat(40), ...env };
  return {
    get: (k: string) => all[k],
    getOrThrow: (k: string) => { if (!all[k]) throw new Error(k); return all[k]; },
  } as unknown as ConfigService;
}

function fakeSide() {
  const sent: { userId: string; text: string }[] = [];
  const emails: { template: string; to: string; data: Record<string, unknown> }[] = [];
  const notifications = {
    send: async (userId: string, text: string) => { sent.push({ userId, text }); return {}; },
  } as unknown as NotificationsService;
  const email = {
    enqueue: async (template: string, to: string, data: Record<string, unknown>) => { emails.push({ template, to, data }); return 'e1'; },
  } as unknown as EmailService;
  return { sent, emails, notifications, email };
}

type Reply = { rows: unknown[] } | { error: unknown };

/** Answers queries in order from `replies`; records the SQL and params. */
function orderedPool(replies: Reply[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [] };
    const next = replies.shift() ?? { rows: [] };
    if ('error' in next) throw next.error;
    return { rowCount: next.rows.length, ...next };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params };
}

function setup(pool: Pool, env?: Record<string, string>) {
  const side = fakeSide();
  const svc = new PayoutsService(pool, fakeConfig(env), new LedgerService(pool), side.notifications, side.email);
  return { svc, ...side };
}

const sealedFor = (userId = 'exp-1') =>
  sealDetails({ method: 'bank', accountHolder: 'Eshan E', accountNumber: '123456789012', ifsc: 'HDFC0001234' }, userId, KEY);

const accountRow = (over: Record<string, unknown> = {}) => ({
  user_id: 'exp-1', method: 'bank', account_holder: 'Eshan E', details_encrypted: 'v1.sealed', account_last4: '9012',
  ifsc: 'HDFC0001234', upi_masked: null, verified: false, updated_at: new Date(), ...over,
});
const requestRow = (over: Record<string, unknown> = {}) => ({
  id: PID, user_id: 'exp-1', amount: '1000.00', currency: 'INR', status: 'requested', method: 'bank',
  account_holder: 'Eshan E', account_masked: 'XXXXXX9012 · HDFC0001234', details_encrypted: sealedFor(),
  admin_note: null, reference: null, requested_at: new Date(), decided_at: null, decided_by: null, paid_at: null, ...over,
});
/** Replies for LedgerService.getWallet: an expert with `earned` released and `pending` in open requests. */
const wallet = (earned: number, pending = 0): Reply[] => [
  { rows: [{ type: 'Escrow release', ref: 'CT-1/m-1', user_id: 'exp-1', payee_id: 'exp-1', total: String(earned) }] },
  { rows: [] },
  { rows: [{ pending: String(pending) }] },
];

// ─── Account details ────────────────────────────────────────────────────────

describe('payout account validation', () => {
  it('accepts a bank account, normalising spaces and IFSC case', () => {
    const out = parsePayoutAccount({ method: 'bank', accountHolder: '  Eshan   E ', accountNumber: '1234 5678 9012', ifsc: 'hdfc0001234' });
    assert.deepEqual(out.account, { method: 'bank', accountHolder: 'Eshan E', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
  });

  it('rejects malformed IFSC codes and account numbers', () => {
    for (const ifsc of ['HDFC1001234', 'HDF00001234', 'HDFC000123', 'HDFC00012345']) {
      assert.match(parsePayoutAccount({ method: 'bank', accountHolder: 'E E', accountNumber: '123456789', ifsc }).error ?? '', /IFSC/, ifsc);
    }
    for (const accountNumber of ['12345678', '1234567890123456789', '12345678a']) {
      assert.match(parsePayoutAccount({ method: 'bank', accountHolder: 'E E', accountNumber, ifsc: 'HDFC0001234' }).error ?? '', /9 to 18/, accountNumber);
    }
  });

  it('accepts UPI ids and rejects malformed ones or mixed methods', () => {
    assert.ok(parsePayoutAccount({ method: 'upi', accountHolder: 'E E', upiId: 'eshan.e-1@okhdfc' }).account);
    for (const upiId of ['eshan', 'e@okhdfc', 'eshan@1bank', 'eshan@x']) {
      assert.match(parsePayoutAccount({ method: 'upi', accountHolder: 'E E', upiId }).error ?? '', /UPI/, upiId);
    }
    assert.ok(parsePayoutAccount({ method: 'upi', accountHolder: 'E E', upiId: 'eshan@okhdfc', ifsc: 'HDFC0001234' }).error);
    assert.ok(parsePayoutAccount({ method: 'bank', accountHolder: 'E', accountNumber: '123456789', ifsc: 'HDFC0001234' }).error);
  });

  it('masks account numbers and UPI ids', () => {
    const bank = maskAccount({ method: 'bank', accountHolder: 'E E', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
    assert.deepEqual(bank, { last4: '9012', ifsc: 'HDFC0001234', upiMasked: null, masked: 'XXXXXX9012 · HDFC0001234' });
    assert.equal(maskUpi('eshan.e@okhdfc'), 'es****@okhdfc');
    assert.equal(maskAccount({ method: 'upi', accountHolder: 'E E', upiId: 'eshan@ybl' }).masked, 'es****@ybl');
  });

  it('round-trips sealed details and refuses another user, another key or tampering', () => {
    const sealed = sealedFor();
    assert.ok(!sealed.includes('123456789012'));
    assert.deepEqual(openDetails(sealed, 'exp-1', KEY, 'bank', 'Eshan E'),
      { method: 'bank', accountHolder: 'Eshan E', accountNumber: '123456789012', ifsc: 'HDFC0001234' });
    assert.throws(() => openDetails(sealed, 'exp-2', KEY, 'bank', 'Eshan E'), /another user/);
    assert.throws(() => openDetails(sealed, 'exp-1', deriveKey('x'.repeat(40), 'payout-details-v1'), 'bank', 'Eshan E'));
    const parts = sealed.split('.');
    parts[3] = Buffer.from('tampered').toString('base64url');
    assert.throws(() => openDetails(parts.join('.'), 'exp-1', KEY, 'bank', 'Eshan E'));
  });
});

describe('PayoutsService.saveAccount', () => {
  it('stores only the sealed details and masked fields, and resets verification', async () => {
    const { pool, sql, params } = orderedPool([{ rows: [accountRow()] }]);
    const out = await setup(pool).svc.saveAccount(expert, {
      method: 'bank', accountHolder: 'Eshan E', accountNumber: '123456789012', ifsc: 'hdfc0001234',
    });
    assert.match(sql[0], /verified = FALSE/);
    const [userId, method, holder, sealed, last4, ifsc, upi] = params[0] as string[];
    assert.deepEqual([userId, method, holder, last4, ifsc, upi], ['exp-1', 'bank', 'Eshan E', '9012', 'HDFC0001234', null]);
    assert.ok(!JSON.stringify(params[0]).includes('123456789012'));
    assert.deepEqual(openDetails(sealed, 'exp-1', KEY, 'bank', 'Eshan E').accountNumber, '123456789012');
    assert.equal(out.masked, 'XXXXXX9012 · HDFC0001234');
    assert.ok(!('detailsEncrypted' in out));
  });

  it('rejects invalid details before touching the database', async () => {
    const { pool, sql } = orderedPool([]);
    await assert.rejects(setup(pool).svc.saveAccount(expert, { method: 'bank', accountHolder: 'E E', accountNumber: '1', ifsc: 'X' }), status(400));
    assert.equal(sql.length, 0);
  });

  it('refuses to seal without PAYOUT_ENCRYPTION_KEY in production', async () => {
    const { pool } = orderedPool([]);
    const { svc } = setup(pool, { PAYOUT_ENCRYPTION_KEY: '', NODE_ENV: 'production' });
    await assert.rejects(svc.saveAccount(expert, { method: 'upi', accountHolder: 'E E', upiId: 'eshan@ybl' }), status(500));
  });
});

// ─── Requests ───────────────────────────────────────────────────────────────

describe('PayoutsService.request', () => {
  it('creates a request within the available balance, under a lock on the payout account', async () => {
    const { pool, sql, params } = orderedPool([
      { rows: [accountRow()] }, { rows: [] }, ...wallet(1500, 0), { rows: [requestRow({ amount: '1000.00' })] },
    ]);
    const out = await setup(pool).svc.request(expert, 1000);
    assert.equal(out.status, 'requested');
    assert.match(sql[1], /FROM payout_accounts WHERE user_id = \$1 FOR UPDATE/);
    const insert = sql.findIndex((q) => /INSERT INTO payout_requests/.test(q));
    assert.ok(insert > sql.findIndex((q) => /FOR UPDATE/.test(q)));
    assert.deepEqual(params[insert].slice(0, 2), ['exp-1', 1000]);
    assert.equal(params[insert][4], 'XXXXXX9012 · HDFC0001234');
    assert.equal(sql.at(-1), 'COMMIT');
  });

  it('enforces PAYOUT_MIN (default 500)', async () => {
    const { pool, sql } = orderedPool([]);
    await assert.rejects(setup(pool).svc.request(expert, 499.99), (e: HttpException) => e.getStatus() === 400 && /500/.test(e.message));
    assert.equal(sql.length, 0);
    const custom = orderedPool([]);
    await assert.rejects(setup(custom.pool, { PAYOUT_MIN: '2000' }).svc.request(expert, 1500), status(400));
  });

  it('needs a payout account', async () => {
    const { pool, sql } = orderedPool([{ rows: [] }]);
    await assert.rejects(setup(pool).svc.request(expert, 600), (e: HttpException) => e.getStatus() === 400 && /payout account/.test(e.message));
    assert.equal(sql.at(-1), 'ROLLBACK');
  });

  it('refuses more than the available balance (open requests already reserved)', async () => {
    const { pool, sql } = orderedPool([{ rows: [accountRow()] }, { rows: [] }, ...wallet(1500, 0)]);
    await assert.rejects(setup(pool).svc.request(expert, 1500.01), (e: HttpException) => e.getStatus() === 400 && /available balance/.test(e.message));
    assert.ok(!sql.some((q) => /INSERT INTO payout_requests/.test(q)));
  });

  it('allows one open request at a time', async () => {
    const { pool } = orderedPool([{ rows: [accountRow()] }, { rows: [{ id: 'open-1' }] }]);
    await assert.rejects(setup(pool).svc.request(expert, 600), status(409));
  });

  it('maps the open-request unique index to 409', async () => {
    const { pool } = orderedPool([{ rows: [accountRow()] }, { rows: [] }, ...wallet(5000), { error: uniqueViolation }]);
    await assert.rejects(setup(pool).svc.request(expert, 600), status(409));
  });

  it('lets only one of two concurrent requests through', async () => {
    // A stateful pool: FOR UPDATE on the payout account is a real per-user lock held until
    // COMMIT / ROLLBACK, and requests are stored, so the second transaction sees the first.
    const requests: { status: string; amount: number }[] = [];
    let lock: Promise<void> = Promise.resolve();
    const pool = {
      connect: async () => {
        let release: (() => void) | null = null;
        const query = async (text: string, values: unknown[] = []) => {
          if (/^(COMMIT|ROLLBACK)$/.test(text)) { release?.(); release = null; return { rows: [] }; }
          if (text === 'BEGIN') return { rows: [] };
          if (/FROM payout_accounts .* FOR UPDATE/s.test(text)) {
            const previous = lock;
            lock = new Promise<void>((r) => { release = r; });
            await previous;
            return { rows: [accountRow()] };
          }
          if (/SELECT id FROM payout_requests/.test(text)) {
            return { rows: requests.filter((r) => r.status === 'requested').map((_, i) => ({ id: `r${i}` })) };
          }
          if (/FROM ledger_entries/.test(text)) return wallet(1000)[0];
          if (/FROM contract_milestones/.test(text)) return { rows: [] };
          if (/SUM\(amount\).*FROM payout_requests/s.test(text)) {
            return { rows: [{ pending: String(requests.reduce((a, r) => a + r.amount, 0)) }] };
          }
          if (/INSERT INTO payout_requests/.test(text)) {
            requests.push({ status: 'requested', amount: Number(values[1]) });
            return { rows: [requestRow({ amount: String(values[1]) })] };
          }
          throw new Error(`unexpected query: ${text}`);
        };
        return { query, release: () => undefined };
      },
    } as unknown as Pool;
    const { svc } = setup(pool);
    const results = await Promise.allSettled([svc.request(expert, 800), svc.request(expert, 800)]);
    assert.equal(results.filter((r) => r.status === 'fulfilled').length, 1);
    const refused = results.find((r): r is PromiseRejectedResult => r.status === 'rejected');
    assert.equal((refused?.reason as HttpException).getStatus(), 409);
    assert.equal(requests.length, 1);
  });
});

describe('PayoutsService.cancel', () => {
  it('cancels the owner\'s requested payout', async () => {
    const { pool, params } = orderedPool([{ rows: [requestRow({ status: 'cancelled' })] }]);
    assert.equal((await setup(pool).svc.cancel(expert, PID)).status, 'cancelled');
    assert.deepEqual(params[0], [PID, 'exp-1']);
  });

  it('refuses an approved payout (409) and someone else\'s (404)', async () => {
    const approved = orderedPool([{ rows: [] }, { rows: [{ status: 'approved' }] }]);
    await assert.rejects(setup(approved.pool).svc.cancel(expert, PID), status(409));
    const missing = orderedPool([{ rows: [] }, { rows: [] }]);
    await assert.rejects(setup(missing.pool).svc.cancel(expert, PID), status(404));
  });
});

// ─── Admin ──────────────────────────────────────────────────────────────────

describe('PayoutsService admin transitions', () => {
  it('approves a requested payout, with an audit row', async () => {
    const { pool, sql } = orderedPool([{ rows: [requestRow()] }, { rows: [requestRow({ status: 'approved' })] }, { rows: [] }]);
    assert.equal((await setup(pool).svc.approve(admin, PID)).status, 'approved');
    assert.ok(sql.some((q) => /INSERT INTO audit_log/.test(q)));
  });

  it('refuses to approve anything but a requested payout', async () => {
    for (const s of ['approved', 'paid', 'rejected', 'cancelled']) {
      const { pool } = orderedPool([{ rows: [requestRow({ status: s })] }]);
      await assert.rejects(setup(pool).svc.approve(admin, PID), status(409), s);
    }
  });

  it('marks an approved payout paid: one Payout ledger row, audit, notification and email', async () => {
    const paid = requestRow({ status: 'paid', reference: 'UTR123456', paid_at: new Date() });
    const { pool, sql, params } = orderedPool([
      { rows: [requestRow({ status: 'approved' })] }, { rows: [paid] }, { rows: [] }, { rows: [] }, { rows: [] },
      { rows: [{ email: 'e@x.com', first_name: 'Eshan' }] },
    ]);
    const { svc, sent, emails } = setup(pool);
    const out = await svc.markPaid(admin, PID, ' UTR123456 ');
    assert.equal(out.status, 'paid');
    const ledger = sql.filter((q) => /INSERT INTO ledger_entries/.test(q));
    assert.equal(ledger.length, 1);
    const li = sql.findIndex((q) => /INSERT INTO ledger_entries/.test(q));
    assert.match(sql[li], /'Payout'/);
    assert.equal(params[li][3], -1000);
    assert.equal(params[li][6], PID);
    assert.ok(sql.some((q) => /UPDATE payout_accounts SET verified = TRUE/.test(q)));
    assert.ok(sql.some((q) => /INSERT INTO audit_log/.test(q)));
    assert.equal(sent.length, 1);
    assert.equal(emails[0].template, 'payout-paid');
    assert.equal(emails[0].data.reference, 'UTR123456');
  });

  it('is idempotent: marking a paid payout paid again writes nothing', async () => {
    const paid = requestRow({ status: 'paid', reference: 'UTR123456', paid_at: new Date() });
    const { pool, sql } = orderedPool([{ rows: [paid] }]);
    const { svc, sent, emails } = setup(pool);
    assert.equal((await svc.markPaid(admin, PID, 'UTR123456')).status, 'paid');
    assert.ok(!sql.some((q) => /INSERT INTO ledger_entries|UPDATE payout_requests/.test(q)));
    assert.equal(sent.length + emails.length, 0);
  });

  it('refuses a different reference on a paid payout, and paying an unapproved one', async () => {
    const paid = orderedPool([{ rows: [requestRow({ status: 'paid', reference: 'UTR123456' })] }]);
    await assert.rejects(setup(paid.pool).svc.markPaid(admin, PID, 'UTR999999'), status(409));
    for (const s of ['requested', 'rejected', 'cancelled']) {
      const { pool, sql } = orderedPool([{ rows: [requestRow({ status: s })] }]);
      await assert.rejects(setup(pool).svc.markPaid(admin, PID, 'UTR123456'), status(409), s);
      assert.ok(!sql.some((q) => /INSERT INTO ledger_entries/.test(q)));
    }
  });

  it('rejects an open payout with a note, notifying and emailing the expert', async () => {
    const { pool, params } = orderedPool([
      { rows: [requestRow({ status: 'approved' })] }, { rows: [requestRow({ status: 'rejected', admin_note: 'Name mismatch' })] },
      { rows: [] }, { rows: [{ email: 'e@x.com', first_name: 'Eshan' }] },
    ]);
    const { svc, emails, sent } = setup(pool);
    const out = await svc.reject(admin, PID, ' Name mismatch ');
    assert.equal(out.status, 'rejected');
    assert.equal(params[2][1], 'Name mismatch');
    assert.equal(emails[0].template, 'payout-rejected');
    assert.match(sent[0].text, /rejected: Name mismatch/);
  });

  it('refuses to reject a paid payout', async () => {
    const { pool } = orderedPool([{ rows: [requestRow({ status: 'paid', reference: 'UTR123456' })] }]);
    await assert.rejects(setup(pool).svc.reject(admin, PID, 'late'), status(409));
  });

  it('reveals the sealed destination to an admin, with an audit row', async () => {
    const { pool, sql } = orderedPool([{ rows: [requestRow()] }, { rows: [] }]);
    const out = await setup(pool).svc.destination(admin, PID);
    assert.equal(out.accountNumber, '123456789012');
    assert.match(sql[1], /INSERT INTO audit_log/);
  });

  it('never returns the sealed details in request views', async () => {
    const { pool } = orderedPool([...wallet(100), { rows: [requestRow()] }]);
    const out = await setup(pool).svc.overview('exp-1');
    assert.equal(out.minimum, 500);
    assert.equal(out.available, 100);
    assert.ok(!JSON.stringify(out).includes('v1.'));
  });
});
