import {
  BadRequestException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
} from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import type { User, UserRole } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { NotificationsService } from '../notifications/notifications.service';
import { mapUserRow, USER_COLUMNS, UserRow } from '../users/user.mapper';
import {
  ACCOUNT_ACTIVE_SQL, NOT_BLOCKED_SQL, TokenIssueTimes, tokenIssueParams, tokenNotRevokedSql,
} from '../auth/account-status';
import {
  MESSAGE_MAX_LENGTH,
  type ChatMember, type ChatMessage, type ChatMessagePage, type ChatSummary, type ChatType, type SendMessageResult,
} from './chat.types';
import { CIRCUMVENTION_WARNING, detectCircumvention } from './circumvention';
import { ChatsRealtime } from './chats.realtime';

/** One "new message" notification per chat per member in this window. */
export const NOTIFY_WINDOW_MINUTES = 10;
const PREVIEW_LENGTH = 140;
const DEFAULT_PAGE = 30;

const iso = (v: Date | string | null): string | null =>
  v == null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString();

/** Order-independent key for a two-person chat, so A→B and B→A find the same row. */
export const pairKey = (a: string, b: string) => (a < b ? `${a}:${b}` : `${b}:${a}`);

export function mapMessage(r: QueryResultRow): ChatMessage {
  return {
    id: r.id,
    chatId: r.chat_id,
    senderId: r.sender_id ?? null,
    body: r.body,
    createdAt: iso(r.created_at) as string,
    editedAt: iso(r.edited_at ?? null),
  };
}

interface MemberJson { id: string; firstName: string | null; lastName: string | null; role: UserRole; avatarUrl: string | null }

function mapSummary(r: QueryResultRow): ChatSummary {
  const members = (r.members as MemberJson[] | null ?? []).map((m): ChatMember => ({
    id: m.id,
    name: [m.firstName, m.lastName].filter(Boolean).join(' ').trim() || 'AsteAI user',
    role: m.role,
    avatarUrl: m.avatarUrl ?? undefined,
  }));
  const body: string | null = r.last_body ?? null;
  return {
    id: r.id,
    type: r.type,
    projectId: r.project_id ?? null,
    projectTitle: r.project_title ?? null,
    members,
    lastMessage: body == null ? null : {
      body: body.length > PREVIEW_LENGTH ? `${body.slice(0, PREVIEW_LENGTH - 1)}…` : body,
      senderId: r.last_sender_id ?? null,
      createdAt: iso(r.last_created_at) as string,
    },
    lastMessageAt: iso(r.last_message_at ?? null),
    unread: Number(r.unread ?? 0),
    createdAt: iso(r.created_at) as string,
  };
}

const SUMMARY_SQL = `
  SELECT c.id, c.type, c.project_id, p.title AS project_title, c.created_at, c.last_message_at,
         lm.body AS last_body, lm.sender_id AS last_sender_id, lm.created_at AS last_created_at,
         (SELECT COUNT(*)::int FROM messages m
            WHERE m.chat_id = c.id AND m.deleted_at IS NULL
              AND m.sender_id IS DISTINCT FROM $1
              AND m.created_at > COALESCE(me.last_read_at, '-infinity'::timestamptz)) AS unread,
         COALESCE((SELECT json_agg(json_build_object(
                     'id', u.id, 'firstName', u.first_name, 'lastName', u.last_name,
                     'role', u.role, 'avatarUrl', u.avatar_url) ORDER BY u.first_name, u.id)
                   FROM chat_members om JOIN user_accounts u ON u.id = om.user_id
                   WHERE om.chat_id = c.id AND om.user_id <> $1), '[]'::json) AS members
    FROM chat_members me
    JOIN chats c ON c.id = me.chat_id
    LEFT JOIN projects p ON p.id = c.project_id
    LEFT JOIN LATERAL (
      SELECT body, sender_id, created_at FROM messages
       WHERE chat_id = c.id AND deleted_at IS NULL
       ORDER BY created_at DESC LIMIT 1
    ) lm ON TRUE
   WHERE me.user_id = $1`;

interface OtherUser { id: string; role: UserRole; tenant_id: string | null }

@Injectable()
export class ChatsService {
  private readonly logger = new Logger(ChatsService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
    private readonly realtime: ChatsRealtime,
  ) {}

  // ── Listing ─────────────────────────────────────────────────────────────────

  async listChats(userId: string): Promise<ChatSummary[]> {
    const { rows } = await this.db.query(
      `${SUMMARY_SQL} ORDER BY c.last_message_at DESC NULLS LAST, c.created_at DESC LIMIT 200`,
      [userId],
    );
    return rows.map(mapSummary);
  }

  private async summary(userId: string, chatId: string): Promise<ChatSummary> {
    const { rows } = await this.db.query(`${SUMMARY_SQL} AND c.id = $2`, [userId, chatId]);
    if (!rows.length) throw new NotFoundException('Chat not found');
    return mapSummary(rows[0]);
  }

  /** Ids of every chat the user belongs to (the gateway joins their rooms on connect). */
  async chatIdsFor(userId: string): Promise<string[]> {
    const { rows } = await this.db.query<{ chat_id: string }>(
      `SELECT chat_id FROM chat_members WHERE user_id = $1`, [userId],
    );
    return rows.map((r) => r.chat_id);
  }

  /**
   * Same lookup as the JWT strategy: the account must still be active (not deactivated or
   * deleted), not banned or suspended, and the token (its `iat` / `iatMs` claims) must not
   * predate the last password change or reset.
   */
  async loadActiveUser(userId: string, token: TokenIssueTimes = {}): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>(
      `SELECT ${USER_COLUMNS} FROM user_accounts
        WHERE id = $1 AND ${ACCOUNT_ACTIVE_SQL} AND ${NOT_BLOCKED_SQL}
          AND ${tokenNotRevokedSql(2, 3)}`,
      [userId, ...tokenIssueParams(token)],
    );

    return rows.length ? mapUserRow(rows[0]) : null;
  }

  // ── Starting a chat ─────────────────────────────────────────────────────────

  /**
   * Who may message whom:
   *  - either side is an Admin (support), or
   *  - the buyer of a project and a freelancer who proposed on it or was awarded it, or
   *  - an Employer and a Candidate who applied to one of the employer's tenant's requisitions.
   * Returns the chat type to create, or throws 403.
   */
  async chatTypeFor(me: User, other: OtherUser, projectId?: string): Promise<ChatType> {
    const isAdmin = me.role === 'Admin' || other.role === 'Admin';

    if (projectId) {
      const { rows } = await this.db.query<{ buyer_id: string; awarded_to: string | null; proposers: string[] }>(
        `SELECT p.buyer_id, p.awarded_to,
                ARRAY(SELECT pr.expert_id::text FROM proposals pr
                       WHERE pr.project_id = p.id AND pr.expert_id = ANY($2::uuid[])) AS proposers
           FROM projects p WHERE p.id = $1`,
        [projectId, [me.id, other.id]],
      );
      if (!rows.length) throw new NotFoundException('Project not found');
      const { buyer_id, awarded_to, proposers } = rows[0];
      const worksOn = (id: string) => awarded_to === id || (proposers ?? []).includes(id);
      const shared = (buyer_id === me.id && worksOn(other.id)) || (buyer_id === other.id && worksOn(me.id));
      if (shared || isAdmin) return 'project';
      throw new ForbiddenException('You can only message people you work with on this project');
    }

    if (isAdmin) return 'support';

    const roles = new Set([me.role, other.role]);
    if (roles.has('Employer') && roles.has('Candidate')) {
      const [employer, candidateId] = me.role === 'Employer' ? [me.tenantId, other.id] : [other.tenant_id, me.id];
      if (employer) {
        const { rows } = await this.db.query(
          `SELECT 1 FROM applications WHERE candidate_id = $1 AND tenant_id = $2 LIMIT 1`,
          [candidateId, employer],
        );
        if (rows.length) return 'direct';
      }
      throw new ForbiddenException('Candidates can only be messaged by employers they applied to');
    }

    const { rows } = await this.db.query(
      `SELECT 1 FROM projects p
        WHERE (p.buyer_id = $1 AND (p.awarded_to = $2 OR EXISTS (
                 SELECT 1 FROM proposals pr WHERE pr.project_id = p.id AND pr.expert_id = $2)))
           OR (p.buyer_id = $2 AND (p.awarded_to = $1 OR EXISTS (
                 SELECT 1 FROM proposals pr WHERE pr.project_id = p.id AND pr.expert_id = $1)))
        LIMIT 1`,
      [me.id, other.id],
    );
    if (rows.length) return 'direct';
    // The buyer and expert of a gig order (a contract with no project) may message each other.
    const { rows: gig } = await this.db.query(
      `SELECT 1 FROM contracts c
        WHERE c.source = 'gig' AND c.status <> 'draft'
          AND ((c.buyer_id = $1 AND c.expert_id = $2) OR (c.buyer_id = $2 AND c.expert_id = $1))
        LIMIT 1`,
      [me.id, other.id],
    );
    if (gig.length) return 'direct';
    throw new ForbiddenException('You can only message people you work with');
  }

  /** Returns the existing chat for this pair (and project) or creates it. */
  async startChat(me: User, userId: string, projectId?: string): Promise<ChatSummary> {
    if (userId === me.id) throw new BadRequestException('You cannot start a chat with yourself');

    const { rows: users } = await this.db.query<OtherUser>(
      `SELECT id, role, tenant_id FROM user_accounts
        WHERE id = $1 AND account_status = 'active' AND deleted_at IS NULL`,
      [userId],
    );
    if (!users.length) throw new NotFoundException('User not found');

    const type = await this.chatTypeFor(me, users[0], projectId);
    const key = pairKey(me.id, userId);
    const project = type === 'project' ? projectId ?? null : null;

    const { chatId, created } = await withTransaction(this.db, async (client) => {
      const inserted = await client.query<{ id: string }>(
        `INSERT INTO chats (type, project_id, pair_key, created_by) VALUES ($1, $2, $3, $4)
         ON CONFLICT (type, (COALESCE(project_id, '')), pair_key) WHERE pair_key IS NOT NULL DO NOTHING
         RETURNING id`,
        [type, project, key, me.id],
      );
      if (inserted.rows.length) {
        const id = inserted.rows[0].id;
        await client.query(
          `INSERT INTO chat_members (chat_id, user_id) VALUES ($1, $2), ($1, $3) ON CONFLICT DO NOTHING`,
          [id, me.id, userId],
        );
        return { chatId: id, created: true };
      }
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM chats WHERE type = $1 AND COALESCE(project_id, '') = COALESCE($2, '') AND pair_key = $3`,
        [type, project, key],
      );
      return { chatId: existing.rows[0].id, created: false };
    });

    if (created) this.realtime.join(chatId, [me.id, userId]);
    return this.summary(me.id, chatId);
  }

  // ── Membership ──────────────────────────────────────────────────────────────

  /** 404 for an unknown chat, 403 when the user is not in it. */
  async assertMember(chatId: string, userId: string): Promise<void> {
    const { rows } = await this.db.query<{ member: boolean }>(
      `SELECT (m.user_id IS NOT NULL) AS member
         FROM chats c LEFT JOIN chat_members m ON m.chat_id = c.id AND m.user_id = $2
        WHERE c.id = $1`,
      [chatId, userId],
    );
    if (!rows.length) throw new NotFoundException('Chat not found');
    if (!rows[0].member) throw new ForbiddenException('You are not a member of this chat');
  }

  // ── Messages ────────────────────────────────────────────────────────────────

  /** Newest page first; `before` is the previous page's `nextBefore`. */
  async listMessages(user: User, chatId: string, before?: string, limit = DEFAULT_PAGE): Promise<ChatMessagePage> {
    await this.assertMember(chatId, user.id);
    const size = Math.min(Math.max(limit, 1), 100);
    const { rows } = await this.db.query(
      `SELECT id, chat_id, sender_id, body, created_at, edited_at,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
         FROM messages
        WHERE chat_id = $1 AND deleted_at IS NULL
          AND ($2::timestamptz IS NULL OR created_at < $2::timestamptz)
        ORDER BY created_at DESC, id DESC
        LIMIT $3`,
      [chatId, before ?? null, size + 1],
    );
    const more = rows.length > size;
    const page = rows.slice(0, size);
    return {
      messages: page.map(mapMessage).reverse(),
      nextBefore: more && page.length ? page[page.length - 1].cursor : null,
    };
  }

  /**
   * The one send path (REST today; a socket handler would call this too): stores the
   * message, logs circumvention patterns, notifies the other members at most once per
   * chat every 10 minutes, then pushes the message to the chat's socket room.
   */
  async sendMessage(user: User, chatId: string, rawBody: string): Promise<SendMessageResult> {
    const body = (rawBody ?? '').trim();
    if (!body) throw new BadRequestException('Message cannot be empty');
    if (body.length > MESSAGE_MAX_LENGTH) {
      throw new BadRequestException(`Message must be at most ${MESSAGE_MAX_LENGTH} characters`);
    }
    await this.assertMember(chatId, user.id);
    const patterns = detectCircumvention(body);

    const message = await withTransaction(this.db, async (client) => {
      const { rows } = await client.query(
        `INSERT INTO messages (chat_id, sender_id, body) VALUES ($1, $2, $3)
         RETURNING id, chat_id, sender_id, body, created_at, edited_at`,
        [chatId, user.id, body],
      );
      const msg = mapMessage(rows[0]);
      // Timestamps are copied in SQL: JS dates would drop the microseconds.
      await client.query(
        `UPDATE chats SET last_message_at = m.created_at FROM messages m WHERE chats.id = $1 AND m.id = $2`,
        [chatId, msg.id],
      );
      // Your own message counts as read.
      await client.query(
        `UPDATE chat_members cm SET last_read_at = GREATEST(COALESCE(cm.last_read_at, m.created_at), m.created_at)
           FROM messages m
          WHERE m.id = $3 AND cm.chat_id = $1 AND cm.user_id = $2`,
        [chatId, user.id, msg.id],
      );
      if (patterns.length) {
        await client.query(
          `INSERT INTO circumvention_logs (user_id, chat_id, message_id, pattern)
           SELECT $1::uuid, $2::uuid, $3::uuid, unnest($4::text[])`,
          [user.id, chatId, msg.id, patterns],
        );
      }
      await this.notifyMembers(client, user, chatId);
      return msg;
    });

    this.realtime.message(message);
    if (patterns.length) {
      this.logger.warn(`Circumvention patterns [${patterns.join(', ')}] from user ${user.id} in chat ${chatId}`);
      return { message, warning: CIRCUMVENTION_WARNING };
    }
    return { message };
  }

  /**
   * Claims the notification slot for every other member whose last notification for
   * this chat is older than the window (a conditional UPDATE, so concurrent sends and
   * several API instances never double-notify), then notifies just those members.
   */
  private async notifyMembers(client: PoolClient, sender: User, chatId: string) {
    const { rows } = await client.query<{ user_id: string }>(
      `UPDATE chat_members SET last_notified_at = NOW()
        WHERE chat_id = $1 AND user_id <> $2
          AND (last_notified_at IS NULL OR last_notified_at < NOW() - make_interval(mins => $3))
        RETURNING user_id`,
      [chatId, sender.id, NOTIFY_WINDOW_MINUTES],
    );
    const name = [sender.firstName, sender.lastName].filter(Boolean).join(' ').trim() || 'Someone';
    for (const { user_id } of rows) {
      await this.notifications.send(user_id, `New message from ${name}`, `/platform/messages?chat=${chatId}`, client);
    }
  }

  async markRead(user: User, chatId: string): Promise<{ chatId: string; readAt: string }> {
    await this.assertMember(chatId, user.id);
    const { rows } = await this.db.query<{ last_read_at: Date }>(
      `UPDATE chat_members SET last_read_at = NOW() WHERE chat_id = $1 AND user_id = $2 RETURNING last_read_at`,
      [chatId, user.id],
    );
    const readAt = iso(rows[0]?.last_read_at ?? new Date()) as string;
    this.realtime.read({ chatId, userId: user.id, readAt });
    return { chatId, readAt };
  }
}
