import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { HttpException } from '@nestjs/common';
import type { Pool } from 'pg';
import type { User } from '@asteai/types';
import type { NotificationsService } from '../notifications/notifications.service';
import { ChatsRealtime } from './chats.realtime';
import { ChatsService, NOTIFY_WINDOW_MINUTES, pairKey } from './chats.service';
import { CIRCUMVENTION_WARNING, detectCircumvention } from './circumvention';
import { ChatsGateway, handshakeToken } from './chats.gateway';
import { ACCOUNT_ACTIVE_SQL, NOT_BLOCKED_SQL, tokenNotRevokedSql } from '../auth/account-status';
import type { JwtService } from '@nestjs/jwt';
import type { ConfigService } from '@nestjs/config';

const BUYER = '00000000-0000-4000-8000-00000000000b';
const FREELANCER = '00000000-0000-4000-8000-00000000000f';
const EMPLOYER = '00000000-0000-4000-8000-00000000000e';
const CANDIDATE = '00000000-0000-4000-8000-00000000000c';
const ADMIN = '00000000-0000-4000-8000-00000000000a';
const CHAT = '11111111-1111-4111-8111-111111111111';

const user = (id: string, role: User['role'], over: Partial<User> = {}) =>
  ({ id, role, tenantId: null, firstName: 'Asha', lastName: 'Rao', ...over }) as User;

const buyer = user(BUYER, 'Buyer');
const employer = user(EMPLOYER, 'Employer', { tenantId: 'acme' });
const candidate = user(CANDIDATE, 'Candidate');

/** A pool that answers queries in order from `replies` and records the SQL it saw. */
function fakePool(replies: { rows: unknown[] }[]) {
  const sql: string[] = [];
  const params: unknown[][] = [];
  const query = async (text: string, values: unknown[] = []) => {
    sql.push(text);
    params.push(values);
    if (/^(BEGIN|COMMIT|ROLLBACK)$/.test(text)) return { rows: [], rowCount: 0 };
    const next = replies.shift() ?? { rows: [] };
    return { rowCount: next.rows.length, ...next };
  };
  const pool = { query, connect: async () => ({ query, release: () => undefined }) } as unknown as Pool;
  return { pool, sql, params, replies };
}

function fakeNotifications() {
  const sent: { userId: string; text: string; link: string }[] = [];
  const svc = {
    send: async (userId: string, text: string, link: string) => {
      sent.push({ userId, text, link });
      return { id: 'n', userId, text, link, read: false, t: 0 };
    },
  } as unknown as NotificationsService;
  return { svc, sent };
}

class RecordingRealtime extends ChatsRealtime {
  events: [string, unknown][] = [];
  message(m: Parameters<ChatsRealtime['message']>[0]) { this.events.push(['message', m]); }
  read(e: Parameters<ChatsRealtime['read']>[0]) { this.events.push(['read', e]); }
  join(chatId: string, userIds: string[]) { this.events.push(['join', { chatId, userIds }]); }
}

function service(replies: { rows: unknown[] }[]) {
  const db = fakePool(replies);
  const notes = fakeNotifications();
  const realtime = new RecordingRealtime();
  return { svc: new ChatsService(db.pool, notes.svc, realtime), db, notes, realtime };
}

const summaryRow = (over: Record<string, unknown> = {}) => ({
  id: CHAT, type: 'project', project_id: 'PRJ-1', project_title: 'Data pipeline', created_at: '2026-11-10T09:00:00Z',
  last_message_at: null, last_body: null, unread: 0,
  members: [{ id: FREELANCER, firstName: 'Ravi', lastName: 'K', role: 'Freelancer', avatarUrl: null }], ...over,
});

const status = (code: number) => (e: HttpException) => e.getStatus() === code;

describe('ChatsService.startChat permissions', () => {
  it('lets a buyer message a freelancer who proposed on their project', async () => {
    const { svc, db, realtime } = service([
      { rows: [{ id: FREELANCER, role: 'Freelancer', tenant_id: null }] },
      { rows: [{ buyer_id: BUYER, awarded_to: null, proposers: [FREELANCER] }] },
      { rows: [{ id: CHAT }] }, // chat inserted
      { rows: [] }, // members
      { rows: [summaryRow()] },
    ]);
    const chat = await svc.startChat(buyer, FREELANCER, 'PRJ-1');
    assert.equal(chat.id, CHAT);
    assert.deepEqual(chat.members.map((m) => m.name), ['Ravi K']);
    const insert = db.sql.findIndex((s) => /INSERT INTO chats/.test(s));
    assert.deepEqual(db.params[insert], ['project', 'PRJ-1', pairKey(BUYER, FREELANCER), BUYER]);
    assert.match(db.sql[insert], /ON CONFLICT/);
    assert.deepEqual(realtime.events, [['join', { chatId: CHAT, userIds: [BUYER, FREELANCER] }]]);
  });

  it('lets the awarded freelancer message the buyer', async () => {
    const freelancer = user(FREELANCER, 'Freelancer');
    const { svc } = service([
      { rows: [{ id: BUYER, role: 'Buyer', tenant_id: null }] },
      { rows: [{ buyer_id: BUYER, awarded_to: FREELANCER, proposers: [] }] },
      { rows: [{ id: CHAT }] }, { rows: [] }, { rows: [summaryRow()] },
    ]);
    assert.equal((await svc.startChat(freelancer, BUYER, 'PRJ-1')).id, CHAT);
  });

  it('refuses a freelancer with no proposal or award on the project', async () => {
    const { svc, db } = service([
      { rows: [{ id: FREELANCER, role: 'Freelancer', tenant_id: null }] },
      { rows: [{ buyer_id: BUYER, awarded_to: null, proposers: [] }] },
    ]);
    await assert.rejects(svc.startChat(buyer, FREELANCER, 'PRJ-1'), status(403));
    assert.ok(!db.sql.some((s) => /INSERT INTO chats/.test(s)));
  });

  it('refuses a project the buyer does not own even if the freelancer proposed', async () => {
    const { svc } = service([
      { rows: [{ id: FREELANCER, role: 'Freelancer', tenant_id: null }] },
      { rows: [{ buyer_id: 'someone-else', awarded_to: null, proposers: [FREELANCER] }] },
    ]);
    await assert.rejects(svc.startChat(buyer, FREELANCER, 'PRJ-1'), status(403));
  });

  it('404s an unknown project or user, 400s yourself', async () => {
    await assert.rejects(service([{ rows: [{ id: FREELANCER, role: 'Freelancer' }] }, { rows: [] }])
      .svc.startChat(buyer, FREELANCER, 'PRJ-X'), status(404));
    await assert.rejects(service([{ rows: [] }]).svc.startChat(buyer, FREELANCER), status(404));
    await assert.rejects(service([]).svc.startChat(buyer, BUYER), status(400));
  });

  it('lets the buyer and expert of a gig order (a contract with no project) message each other', async () => {
    const { svc, db } = service([
      { rows: [{ id: FREELANCER, role: 'Freelancer', tenant_id: null }] },
      { rows: [] }, // no project in common
      { rows: [{ '?column?': 1 }] }, // a gig contract between them
      { rows: [{ id: CHAT }] }, { rows: [] }, { rows: [summaryRow({ type: 'direct', project_id: null })] },
    ]);
    const chat = await svc.startChat(buyer, FREELANCER);
    assert.equal(chat.type, 'direct');
    const gig = db.sql.findIndex((q) => /FROM contracts c/.test(q));
    assert.match(db.sql[gig], /c\.source = 'gig'/);
    assert.deepEqual(db.params[gig], [BUYER, FREELANCER]);
  });

  it('still refuses two people with no project and no gig order in common', async () => {
    await assert.rejects(service([
      { rows: [{ id: FREELANCER, role: 'Freelancer', tenant_id: null }] }, { rows: [] }, { rows: [] },
    ]).svc.startChat(buyer, FREELANCER), status(403));
  });

  it('lets an employer message a candidate who applied to their tenant', async () => {
    const { svc, db } = service([
      { rows: [{ id: CANDIDATE, role: 'Candidate', tenant_id: null }] },
      { rows: [{ '?column?': 1 }] }, // application found
      { rows: [{ id: CHAT }] }, { rows: [] }, { rows: [summaryRow({ type: 'direct', project_id: null })] },
    ]);
    const chat = await svc.startChat(employer, CANDIDATE);
    assert.equal(chat.type, 'direct');
    assert.deepEqual(db.params[1], [CANDIDATE, 'acme']);
  });

  it('lets a candidate reply to an employer whose tenant they applied to', async () => {
    const { svc, db } = service([
      { rows: [{ id: EMPLOYER, role: 'Employer', tenant_id: 'acme' }] },
      { rows: [{}] }, { rows: [{ id: CHAT }] }, { rows: [] }, { rows: [summaryRow({ type: 'direct' })] },
    ]);
    await svc.startChat(candidate, EMPLOYER);
    assert.deepEqual(db.params[1], [CANDIDATE, 'acme']);
  });

  it('refuses an employer and a candidate who never applied to them', async () => {
    await assert.rejects(service([{ rows: [{ id: CANDIDATE, role: 'Candidate', tenant_id: null }] }, { rows: [] }])
      .svc.startChat(employer, CANDIDATE), status(403));
    // An employer without a tenant has no requisitions anyone could have applied to.
    const noTenant = service([{ rows: [{ id: CANDIDATE, role: 'Candidate', tenant_id: null }] }]);
    await assert.rejects(noTenant.svc.startChat(user(EMPLOYER, 'Employer'), CANDIDATE), status(403));
    assert.equal(noTenant.db.sql.length, 1);
  });

  it('lets anyone message an admin (support) without a relationship check', async () => {
    const { svc, db } = service([
      { rows: [{ id: ADMIN, role: 'Admin', tenant_id: null }] },
      { rows: [{ id: CHAT }] }, { rows: [] }, { rows: [summaryRow({ type: 'support' })] },
    ]);
    await svc.startChat(candidate, ADMIN);
    const insert = db.sql.findIndex((s) => /INSERT INTO chats/.test(s));
    assert.equal(db.params[insert][0], 'support');
    assert.ok(!db.sql.some((s) => /FROM applications|FROM projects/.test(s)));
  });

  it('refuses two unrelated users', async () => {
    const other = user(FREELANCER, 'Freelancer');
    await assert.rejects(service([{ rows: [{ id: BUYER, role: 'Buyer', tenant_id: null }] }, { rows: [] }])
      .svc.startChat(other, BUYER), status(403));
    await assert.rejects(service([{ rows: [{ id: CANDIDATE, role: 'Candidate', tenant_id: null }] }, { rows: [] }])
      .svc.startChat(user('c2', 'Candidate'), CANDIDATE), status(403));
  });

  it('returns the existing chat instead of creating a second one', async () => {
    const { svc, db, realtime } = service([
      { rows: [{ id: ADMIN, role: 'Admin', tenant_id: null }] },
      { rows: [] }, // insert hit the unique key
      { rows: [{ id: CHAT }] }, // existing chat
      { rows: [summaryRow({ type: 'support' })] },
    ]);
    assert.equal((await svc.startChat(buyer, ADMIN)).id, CHAT);
    assert.ok(!db.sql.some((s) => /INSERT INTO chat_members/.test(s)));
    assert.deepEqual(realtime.events, []);
  });

  it('builds the same pair key whichever side starts', () => {
    assert.equal(pairKey(BUYER, FREELANCER), pairKey(FREELANCER, BUYER));
  });
});

describe('ChatsService membership', () => {
  it('refuses non-members (403) and unknown chats (404)', async () => {
    await assert.rejects(service([{ rows: [{ member: false }] }]).svc.listMessages(buyer, CHAT), status(403));
    await assert.rejects(service([{ rows: [] }]).svc.listMessages(buyer, CHAT), status(404));
    await assert.rejects(service([{ rows: [{ member: false }] }]).svc.markRead(buyer, CHAT), status(403));
  });

  it('does not store a message from a non-member', async () => {
    const { svc, db, realtime } = service([{ rows: [{ member: false }] }]);
    await assert.rejects(svc.sendMessage(buyer, CHAT, 'hello'), status(403));
    assert.ok(!db.sql.some((s) => /INSERT INTO messages/.test(s)));
    assert.deepEqual(realtime.events, []);
  });

  it('pages messages oldest-to-newest with a cursor for the next older page', async () => {
    const rows = [3, 2, 1].map((n) => ({
      id: `m${n}`, chat_id: CHAT, sender_id: BUYER, body: `#${n}`, created_at: `2026-11-10T09:0${n}:00Z`,
      edited_at: null, cursor: `2026-11-10T09:0${n}:00.000000Z`,
    }));
    const { svc, db } = service([{ rows: [{ member: true }] }, { rows }]);
    const page = await svc.listMessages(buyer, CHAT, undefined, 2);
    assert.deepEqual(page.messages.map((m) => m.body), ['#2', '#3']);
    assert.equal(page.nextBefore, '2026-11-10T09:02:00.000000Z');
    assert.deepEqual(db.params[1], [CHAT, null, 3]);
  });
});

describe('ChatsService.sendMessage', () => {
  const inserted = (body: string) => ({
    rows: [{ id: 'm1', chat_id: CHAT, sender_id: BUYER, body, created_at: '2026-11-10T09:00:00Z', edited_at: null }],
  });

  it('trims and rejects empty or over-long messages before touching the database', async () => {
    const { svc, db } = service([]);
    await assert.rejects(svc.sendMessage(buyer, CHAT, '   \n '), status(400));
    await assert.rejects(svc.sendMessage(buyer, CHAT, 'x'.repeat(4001)), status(400));
    assert.equal(db.sql.length, 0);
  });

  it('delivers a clean message without a warning and pushes it to the room', async () => {
    const { svc, db, realtime } = service([
      { rows: [{ member: true }] }, inserted('Hi there'), { rows: [] }, { rows: [] }, { rows: [] },
    ]);
    const out = await svc.sendMessage(buyer, CHAT, '  Hi there  ');
    assert.equal(out.message.body, 'Hi there');
    assert.equal(out.warning, undefined);
    assert.ok(!db.sql.some((s) => /circumvention_logs/.test(s)));
    assert.deepEqual(realtime.events.map(([e]) => e), ['message']);
  });

  it('logs circumvention patterns and warns, but still delivers the message', async () => {
    const body = 'Email me at ravi.k@gmail.com or WhatsApp +91 98765 43210';
    const { svc, db, realtime } = service([
      { rows: [{ member: true }] }, inserted(body), { rows: [] }, { rows: [] }, { rows: [] }, { rows: [] },
    ]);
    const out = await svc.sendMessage(buyer, CHAT, body);
    assert.equal(out.warning, CIRCUMVENTION_WARNING);
    assert.equal(out.message.id, 'm1');
    const log = db.sql.findIndex((s) => /INSERT INTO circumvention_logs/.test(s));
    assert.ok(log > 0);
    assert.deepEqual(db.params[log], [BUYER, CHAT, 'm1', ['email', 'phone', 'whatsapp']]);
    assert.deepEqual(realtime.events.map(([e]) => e), ['message']);
  });

  it('notifies only the members whose 10-minute slot was free', async () => {
    const { svc, db, notes } = service([
      { rows: [{ member: true }] }, inserted('hey'), { rows: [] }, { rows: [] },
      { rows: [{ user_id: FREELANCER }] }, // slot claimed for the freelancer
    ]);
    await svc.sendMessage(buyer, CHAT, 'hey');
    const claim = db.sql.findIndex((s) => /SET last_notified_at = NOW\(\)/.test(s));
    assert.match(db.sql[claim], /last_notified_at IS NULL OR last_notified_at < NOW\(\) - make_interval/);
    assert.match(db.sql[claim], /user_id <> \$2/);
    assert.deepEqual(db.params[claim], [CHAT, BUYER, NOTIFY_WINDOW_MINUTES]);
    assert.deepEqual(notes.sent, [{ userId: FREELANCER, text: 'New message from Asha Rao', link: `/platform/messages?chat=${CHAT}` }]);
  });

  it('sends no notification while the slot is still taken', async () => {
    const { svc, notes } = service([
      { rows: [{ member: true }] }, inserted('again'), { rows: [] }, { rows: [] }, { rows: [] },
    ]);
    await svc.sendMessage(buyer, CHAT, 'again');
    assert.deepEqual(notes.sent, []);
  });
});

describe('detectCircumvention', () => {
  const cases: [string, string[]][] = [
    ['Happy to start Monday, milestones look good.', []],
    ['The budget is 1,50,000 and the deadline is 2026-11-10 10:30.', []],
    ['Reach me on ravi@example.com', ['email']],
    ['ravi at gmail dot com', ['email']],
    ['Call me 9876543210', ['phone']],
    ['my number: +1 (415) 555-0132', ['phone']],
    ['office line (415) 555-0132', ['phone']],
    ["Let's pay outside the platform to save fees", ['pay_outside']],
    ['Can you pay me directly by bank transfer?', ['pay_outside']],
    ['ping me on whatsapp', ['whatsapp']],
    ['wa.me/919876543210', ['phone', 'whatsapp']],
    ['my telegram is @ravi', ['telegram']],
    ['send to ravi@okaxis', ['upi']],
    ['what is your UPI id?', ['upi']],
  ];
  for (const [text, expected] of cases) {
    it(JSON.stringify(text), () => assert.deepEqual(detectCircumvention(text), expected));
  }
});

describe('handshakeToken', () => {
  const sock = (auth: unknown, query: Record<string, string> = {}) =>
    ({ handshake: { auth, query } }) as unknown as Parameters<typeof handshakeToken>[0];

  it('reads the token from handshake.auth only', () => {
    assert.equal(handshakeToken(sock({ token: 'abc' })), 'abc');
    assert.equal(handshakeToken(sock({}, { token: 'abc' })), null);
    assert.equal(handshakeToken(sock({ token: 42 })), null);
    assert.equal(handshakeToken(sock(undefined)), null);
  });
});

describe('ChatsService.loadActiveUser', () => {
  const row = {
    id: BUYER, email: 'b@x.io', first_name: 'B', last_name: 'X', role: 'Buyer', tenant_id: null,
    account_status: 'active', email_verified: true, created_at: '2026-01-01', updated_at: '2026-01-01',
  };

  it('applies the JWT strategy rules: active, not blocked, token not older than the password', async () => {
    const { svc, db } = service([{ rows: [row] }]);
    const found = await svc.loadActiveUser(BUYER, { iat: 1_800_000_000, iatMs: 1_800_000_000_123 });
    assert.equal(found?.id, BUYER);
    assert.ok(db.sql[0].includes(ACCOUNT_ACTIVE_SQL));
    assert.ok(db.sql[0].includes(NOT_BLOCKED_SQL));
    assert.ok(db.sql[0].includes(tokenNotRevokedSql(2, 3)));
    assert.deepEqual(db.params[0], [BUYER, 1_800_000_000_123, 1_800_000_000]);
  });

  it('falls back to the whole-second rule for a token without iatMs', async () => {
    const { svc, db } = service([{ rows: [row] }]);
    await svc.loadActiveUser(BUYER, { iat: 1_800_000_000 });
    assert.deepEqual(db.params[0], [BUYER, null, 1_800_000_000]);
  });

  it('returns null when no row matches (inactive, deleted, blocked or stale token)', async () => {
    const { svc } = service([{ rows: [] }]);
    assert.equal(await svc.loadActiveUser(BUYER, { iat: 1 }), null);
  });
});

describe('ChatsGateway.authenticate', () => {
  function gateway(payload: Record<string, unknown>, active: User | null) {
    const lookups: [string, unknown][] = [];
    const jwt = { verifyAsync: async () => payload } as unknown as JwtService;
    const config = { getOrThrow: () => 'secret' } as unknown as ConfigService;
    const chats = {
      loadActiveUser: async (id: string, token?: { iat?: unknown; iatMs?: unknown }) => {
        lookups.push([id, [token?.iat, token?.iatMs]]);
        return active;
      },
    } as unknown as ChatsService;
    const gw = new ChatsGateway(jwt, config, chats, new ChatsRealtime());
    const socket = { handshake: { auth: { token: 't' } }, data: {}, disconnect: () => undefined };
    return { gw, socket: socket as unknown as Parameters<ChatsGateway['authenticate']>[0], lookups };
  }

  it('passes the token issue times to the user lookup', async () => {
    const { gw, socket, lookups } = gateway({ sub: BUYER, role: 'Buyer', iat: 1_700_000_000, iatMs: 1_700_000_000_250 }, buyer);
    await gw.authenticate(socket);
    assert.deepEqual(lookups, [[BUYER, [1_700_000_000, 1_700_000_000_250]]]);

    assert.equal(socket.data.user.id, BUYER);
  });

  it('rejects a token whose user is inactive, blocked or changed the password since', async () => {
    const { gw, socket } = gateway({ sub: BUYER, role: 'Buyer', iat: 1 }, null);
    await assert.rejects(gw.authenticate(socket), /inactive user/);
  });

  it('rejects special-purpose tokens such as 2FA challenges', async () => {
    const { gw, socket, lookups } = gateway({ sub: BUYER, purpose: '2fa' }, buyer);
    await assert.rejects(gw.authenticate(socket), /not an access token/);
    assert.equal(lookups.length, 0);
  });
});
