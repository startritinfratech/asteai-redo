import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Pool, PoolClient } from 'pg';
import type {
  AdminSupportTicket, SupportCategory, SupportMessage, SupportTicket, SupportTicketDetail, TicketStatus, User,
} from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { generateId } from '../../common/utils/ids';
import { EmailService } from '../email/email.service';
import type { AdminUpdateTicketDto, CreateTicketDto } from './dto/support.dto';

interface TicketRow {
  id: string; user_id: string; category_id: string; subject: string; status: TicketStatus; assignee_id: string | null;
  created_at: Date; updated_at: Date; email?: string; first_name?: string | null; last_name?: string | null;
}
interface MessageRow { id: string; from_staff: boolean; body: string; created_at: Date; first_name: string | null; last_name: string | null }

const ticket = (r: TicketRow): SupportTicket => ({
  id: r.id, categoryId: r.category_id, subject: r.subject, status: r.status,
  createdAt: r.created_at.toISOString(), updatedAt: r.updated_at.toISOString(),
});

/** A user only ever sees "ASTEAI Support" for staff replies, never the staff member's name. */
const message = (r: MessageRow): SupportMessage => ({
  id: r.id, fromStaff: r.from_staff, body: r.body, createdAt: r.created_at.toISOString(),
  authorName: r.from_staff ? 'ASTEAI Support' : [r.first_name, r.last_name].filter(Boolean).join(' ') || 'You',
});

/** Next status after a message: a staff reply waits on the user; a user reply (re)opens. */
export function statusAfterMessage(fromStaff: boolean): TicketStatus {
  return fromStaff ? 'pending_user' : 'open';
}

@Injectable()
export class SupportService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly email: EmailService,
  ) {}

  async categories(): Promise<SupportCategory[]> {
    const { rows } = await this.db.query<SupportCategory>(`SELECT id, name FROM support_categories ORDER BY sort, name`);
    return rows;
  }

  async create(dto: CreateTicketDto, user: User): Promise<SupportTicketDetail> {
    return withTransaction(this.db, async (client) => {
      const cat = await client.query(`SELECT 1 FROM support_categories WHERE id = $1`, [dto.categoryId]);
      if (!cat.rowCount) throw new BadRequestException('Unknown support category');
      const { rows } = await client.query<TicketRow>(
        `INSERT INTO support_tickets (id, user_id, category_id, subject) VALUES ($1, $2, $3, $4) RETURNING *`,
        [generateId('TKT'), user.id, dto.categoryId, dto.subject],
      );
      await client.query(
        `INSERT INTO support_messages (ticket_id, author_id, from_staff, body) VALUES ($1, $2, FALSE, $3)`,
        [rows[0].id, user.id, dto.body],
      );
      return { ...ticket(rows[0]), messages: await this.messagesOf(client, rows[0].id) };
    });
  }

  async mine(user: User): Promise<SupportTicket[]> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT * FROM support_tickets WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 100`, [user.id],
    );
    return rows.map(ticket);
  }

  /** The owner's view. Other users' tickets are a 404 (no existence leak). */
  async get(id: string, user: User): Promise<SupportTicketDetail> {
    const { rows } = await this.db.query<TicketRow>(`SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2`, [id, user.id]);
    if (!rows.length) throw new NotFoundException('Ticket not found');
    return { ...ticket(rows[0]), messages: await this.messagesOf(this.db, id) };
  }

  async reply(id: string, body: string, user: User): Promise<SupportTicketDetail> {
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<TicketRow>(
        `SELECT * FROM support_tickets WHERE id = $1 AND user_id = $2 FOR UPDATE`, [id, user.id],
      );
      if (!rows.length) throw new NotFoundException('Ticket not found');
      return this.addMessage(client, rows[0], user.id, false, body);
    });
  }

  async resolveOwn(id: string, user: User): Promise<SupportTicket> {
    const { rows } = await this.db.query<TicketRow>(
      `UPDATE support_tickets SET status = 'resolved', updated_at = NOW() WHERE id = $1 AND user_id = $2 RETURNING *`, [id, user.id],
    );
    if (!rows.length) throw new NotFoundException('Ticket not found');
    return ticket(rows[0]);
  }

  // ── Staff ──────────────────────────────────────────────────────────────────

  async adminList(status?: TicketStatus): Promise<AdminSupportTicket[]> {
    const { rows } = await this.db.query<TicketRow>(
      `SELECT t.*, u.email, u.first_name, u.last_name
         FROM support_tickets t JOIN user_accounts u ON u.id = t.user_id
        WHERE ($1::text IS NULL OR t.status = $1)
        ORDER BY (t.status = 'open') DESC, t.updated_at ASC LIMIT 200`,
      [status ?? null],
    );
    return rows.map((r) => ({
      ...ticket(r), userId: r.user_id, userEmail: r.email ?? '', assigneeId: r.assignee_id,
      userName: [r.first_name, r.last_name].filter(Boolean).join(' '),
    }));
  }

  async adminGet(id: string): Promise<SupportTicketDetail> {
    const { rows } = await this.db.query<TicketRow>(`SELECT * FROM support_tickets WHERE id = $1`, [id]);
    if (!rows.length) throw new NotFoundException('Ticket not found');
    return { ...ticket(rows[0]), messages: await this.messagesOf(this.db, id) };
  }

  /** Staff reply: stored, ticket → pending_user, and the user gets an email (in the same transaction). */
  async staffReply(id: string, body: string, staff: User): Promise<SupportTicketDetail> {
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<TicketRow>(
        `SELECT t.*, u.email, u.first_name FROM support_tickets t JOIN user_accounts u ON u.id = t.user_id
          WHERE t.id = $1 FOR UPDATE OF t`,
        [id],
      );
      if (!rows.length) throw new NotFoundException('Ticket not found');
      const t = rows[0];
      const out = await this.addMessage(client, t, staff.id, true, body);
      if (t.email) {
        await this.email.enqueue('support-reply', t.email, {
          firstName: t.first_name ?? '', ticketId: t.id, subject: t.subject, path: `/platform/support?ticket=${t.id}`,
        }, { client, userId: t.user_id });
      }
      return out;
    });
  }

  async adminUpdate(id: string, dto: AdminUpdateTicketDto): Promise<SupportTicket> {
    const { rows } = await this.db.query<TicketRow>(
      `UPDATE support_tickets SET status = COALESCE($2, status), assignee_id = COALESCE($3, assignee_id), updated_at = NOW()
        WHERE id = $1 RETURNING *`,
      [id, dto.status ?? null, dto.assigneeId ?? null],
    );
    if (!rows.length) throw new NotFoundException('Ticket not found');
    return ticket(rows[0]);
  }

  private async addMessage(client: PoolClient, t: TicketRow, authorId: string, fromStaff: boolean, body: string): Promise<SupportTicketDetail> {
    await client.query(
      `INSERT INTO support_messages (ticket_id, author_id, from_staff, body) VALUES ($1, $2, $3, $4)`,
      [t.id, authorId, fromStaff, body],
    );
    const { rows } = await client.query<TicketRow>(
      `UPDATE support_tickets SET status = $2, updated_at = NOW() WHERE id = $1 RETURNING *`,
      [t.id, statusAfterMessage(fromStaff)],
    );
    return { ...ticket(rows[0]), messages: await this.messagesOf(client, t.id) };
  }

  private async messagesOf(db: Pool | PoolClient, ticketId: string): Promise<SupportMessage[]> {
    const { rows } = await db.query<MessageRow>(
      `SELECT m.id, m.from_staff, m.body, m.created_at, u.first_name, u.last_name
         FROM support_messages m JOIN user_accounts u ON u.id = m.author_id
        WHERE m.ticket_id = $1 ORDER BY m.created_at, m.id`,
      [ticketId],
    );
    return rows.map(message);
  }
}
