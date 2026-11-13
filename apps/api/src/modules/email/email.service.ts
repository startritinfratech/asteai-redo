import { Inject, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool, PoolClient } from 'pg';
import { DB_POOL } from '../../database/database.module';
import { render, type TemplateData, type TemplateName } from './templates';

export interface EnqueueOptions {
  userId?: string;
  /** A second enqueue with the same key is ignored (e.g. `assessment-reset:<session id>`). */
  dedupeKey?: string;
  /** Write inside the caller's transaction, so the email exists only if the change commits. */
  client?: PoolClient;
}

/**
 * Queues email. Rendering happens here, at enqueue time, so the outbox row holds exactly
 * what will be sent; EmailWorker delivers it.
 */
@Injectable()
export class EmailService {
  private readonly baseUrl: string;

  constructor(@Inject(DB_POOL) private readonly db: Pool, config: ConfigService) {
    this.baseUrl = config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3000';
  }

  /** Returns the outbox row id, or null when the dedupe key was already used. */
  async enqueue<K extends TemplateName>(
    template: K, to: string, data: TemplateData[K], opts: EnqueueOptions = {},
  ): Promise<string | null> {
    const email = render(template, data, this.baseUrl);
    const { rows } = await (opts.client ?? this.db).query<{ id: string }>(
      `INSERT INTO email_outbox (user_id, to_address, template, subject, html, text, dedupe_key)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (dedupe_key) DO NOTHING
       RETURNING id`,
      [opts.userId ?? null, to, template, email.subject, email.html, email.text, opts.dedupeKey ?? null],
    );
    return rows[0]?.id ?? null;
  }
}
