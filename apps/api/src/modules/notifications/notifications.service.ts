import { Injectable, Inject } from '@nestjs/common';
import { Pool, PoolClient, QueryResultRow } from 'pg';
import type { Notification } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';

/** Links must stay on this site: a path like `/platform/assess`, never `//host` or a URL. */
export function safeLink(link: string): string {
  return /^\/(?!\/)[\w\-./?=&%]*$/.test(link) ? link : '#';
}

function mapNotification(r: QueryResultRow): Notification {
  return {
    id: r.id,
    userId: r.user_id,
    t: new Date(r.created_at).getTime(),
    text: r.text,
    link: r.link,
    read: r.read,
  };
}

@Injectable()
export class NotificationsService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async findForUser(userId: string): Promise<Notification[]> {
    const { rows } = await this.db.query(
      `SELECT * FROM notifications WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return rows.map(mapNotification);
  }

  /** Pass `client` to write the notification inside the caller's transaction. */
  async send(userId: string, text: string, link = '#', client?: PoolClient): Promise<Notification> {
    const { rows } = await (client ?? this.db).query(
      `INSERT INTO notifications (user_id, text, link) VALUES ($1,$2,$3) RETURNING *`,
      [userId, text, safeLink(link)],
    );
    return mapNotification(rows[0]);
  }

  async markRead(id: string, userId: string) {
    await this.db.query(
      `UPDATE notifications SET read = TRUE WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
  }

  async markAllRead(userId: string) {
    await this.db.query(`UPDATE notifications SET read = TRUE WHERE user_id = $1`, [userId]);
  }
}
