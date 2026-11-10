import {
  BadRequestException, ConflictException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { paginate } from '../../common/utils/pagination';
import { EmailService } from '../email/email.service';
import { NotificationsService } from '../notifications/notifications.service';
import type { AdminExpertsQueryDto, ListExpertsQueryDto, SetExpertStatusDto } from './dto/profile.dto';
import { buildExpertSearch, CARD_COLUMNS, PASSPORT_BADGE_JOIN, PUBLIC_EXPERT_SQL } from './expert-search';
import {
  ApprovalRow, EXPERT_COLUMNS, ExpertCardRow, mapApprovalItem, mapExpertCard, mapExpertDetail, mapReview,
  ReviewRow,
} from './profile.mapper';
import type {
  ExpertApprovalItem, ExpertDetail, ExpertPage, ExpertProfileStatus, ExpertReviewDecision,
} from './profile.types';

/** Which decisions an admin may take from each status. Draft profiles were never submitted. */
export const ALLOWED_DECISIONS: Record<ExpertProfileStatus, ExpertReviewDecision[]> = {
  draft: [],
  pending: ['approved', 'rejected', 'rework'],
  // Taking an approved expert out of the directory again.
  approved: ['rejected', 'rework'],
  rejected: [],
  rework: [],
};

const DECISION_TEXT: Record<ExpertReviewDecision, { action: string; notice: string }> = {
  approved: {
    action: 'Approved expert profile',
    notice: 'Your expert profile is approved and now listed in the expert directory.',
  },
  rework: {
    action: 'Requested expert profile changes',
    notice: 'An admin asked for changes to your expert profile. Open your profile to see the note.',
  },
  rejected: {
    action: 'Rejected expert profile',
    notice: 'Your expert profile was not approved. Open your profile to see the note.',
  },
};

const REVIEWS_SHOWN = 20;

@Injectable()
export class ExpertsService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
    private readonly email: EmailService,
  ) {}

  /** Public directory: approved profiles only, never an email. */
  async list(filters: ListExpertsQueryDto): Promise<ExpertPage> {
    const q = buildExpertSearch(filters);
    const { rows } = await this.db.query<ExpertCardRow & { total: string }>(q.text, q.values);
    return {
      items: rows.map(mapExpertCard),
      total: rows.length ? Number(rows[0].total) : 0,
      page: q.page,
      pageSize: q.pageSize,
    };
  }

  /**
   * One public profile with its latest reviews. Anyone sees an approved profile; the
   * owner and admins also see it while it is draft / pending / rejected / in rework.
   */
  async detail(userId: string, viewer: User | null): Promise<ExpertDetail> {
    const privileged = viewer !== null && (viewer.id === userId || viewer.role === 'Admin');
    const { rows } = await this.db.query<ExpertCardRow>(
      `SELECT ${CARD_COLUMNS}
         FROM expert_profiles p
         JOIN user_accounts u ON u.id = p.user_id
         ${PASSPORT_BADGE_JOIN}
        WHERE p.user_id = $1 AND (${PUBLIC_EXPERT_SQL} OR $2::boolean)`,
      [userId, privileged],
    );
    if (!rows.length) throw new NotFoundException('Expert not found');

    const reviews = await this.db.query<ReviewRow>(
      `SELECT r.id, r.rating, r.comment, r.project_id, r.created_at, pr.title AS project_title,
              ru.first_name AS reviewer_first_name, ru.last_name AS reviewer_last_name
         FROM reviews r
         JOIN user_accounts ru ON ru.id = r.reviewer_id
         LEFT JOIN projects pr ON pr.id = r.project_id
        WHERE r.reviewee_id = $1
        ORDER BY r.created_at DESC
        LIMIT ${REVIEWS_SHOWN}`,
      [userId],
    );
    return mapExpertDetail(rows[0], reviews.rows.map(mapReview));
  }

  /** Admin queue, oldest first so nobody waits longest. Defaults to pending. */
  async adminList(query: AdminExpertsQueryDto): Promise<{ items: ExpertApprovalItem[]; total: number; page: number; pageSize: number }> {
    const { page, pageSize, offset } = paginate(query.page, query.pageSize, 25, 100);
    const { rows } = await this.db.query<ApprovalRow & { total: string }>(
      `SELECT ${EXPERT_COLUMNS}, u.first_name, u.last_name, u.email, COUNT(*) OVER () AS total
         FROM expert_profiles p
         JOIN user_accounts u ON u.id = p.user_id
        WHERE p.status = $1
        ORDER BY p.updated_at ASC, p.user_id
        LIMIT $2 OFFSET $3`,
      [query.status ?? 'pending', pageSize, offset],
    );
    return { items: rows.map(mapApprovalItem), total: rows.length ? Number(rows[0].total) : 0, page, pageSize };
  }

  /**
   * Approve, reject or send back a profile. The change, an audit_log entry, the
   * freelancer's in-app notification and the decision email are written in one transaction.
   */
  async setStatus(admin: User, userId: string, dto: SetExpertStatusDto): Promise<ExpertApprovalItem> {
    const note = dto.note?.trim() || null;
    if (dto.status !== 'approved' && (!note || note.length < 5)) {
      throw new BadRequestException('Add a note (5+ characters) telling the freelancer what to change');
    }

    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{ status: ExpertProfileStatus }>(
        `SELECT status FROM expert_profiles WHERE user_id = $1 FOR UPDATE`,
        [userId],
      );
      if (!rows.length) throw new NotFoundException('Expert profile not found');
      const from = rows[0].status;
      if (!ALLOWED_DECISIONS[from].includes(dto.status)) {
        throw new ConflictException(`A ${from} profile cannot be marked ${dto.status}`);
      }

      const updated = await client.query<ApprovalRow>(
        `UPDATE expert_profiles p
            SET status = $2, admin_note = $3, reviewed_by = $4, reviewed_at = NOW(), updated_at = NOW()
           FROM user_accounts u
          WHERE p.user_id = $1 AND u.id = p.user_id
          RETURNING ${EXPERT_COLUMNS}, u.first_name, u.last_name, u.email`,
        [userId, dto.status, note, admin.id],
      );
      const text = DECISION_TEXT[dto.status];
      await client.query(
        `INSERT INTO audit_log (actor_id, actor_name, role, action, entity, meta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          admin.id, [admin.firstName, admin.lastName].filter(Boolean).join(' '), admin.role, text.action,
          `expert_profile:${userId}`, JSON.stringify({ from, to: dto.status, note }),
        ],
      );
      await this.notifications.send(userId, text.notice, '/platform/profile', client);
      const item = mapApprovalItem(updated.rows[0]);
      const row = updated.rows[0];
      // Queued in this transaction, so the email exists only if the decision commits.
      await this.email.enqueue('expert-profile-decision', row.email, {
        firstName: row.first_name ?? '', decision: dto.status, note, path: '/platform/profile',
      }, { userId, client, dedupeKey: `expert-decision:${userId}:${item.reviewedAt}` });
      return item;
    });
  }
}
