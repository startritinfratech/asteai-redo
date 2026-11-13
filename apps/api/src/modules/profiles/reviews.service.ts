import {
  ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL, withTransaction } from '../../database/database.module';
import { isUniqueViolation } from '../../common/utils/pg-errors';
import { NotificationsService } from '../notifications/notifications.service';
import type { CreateReviewDto } from './dto/profile.dto';
import { mapReview, ReviewRow } from './profile.mapper';
import type { ExpertReview } from './profile.types';

@Injectable()
export class ReviewsService {
  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly notifications: NotificationsService,
  ) {}

  /**
   * A review between a project's buyer and its awarded freelancer (either direction),
   * once the project is Completed; one per project and direction. When the reviewee is
   * an expert, their rating and review_count are recomputed in the same transaction.
   */
  async create(reviewer: User, dto: CreateReviewDto): Promise<ExpertReview> {
    return withTransaction(this.db, async (client) => {
      const { rows } = await client.query<{ buyer_id: string; awarded_to: string | null; stage: string; title: string }>(
        `SELECT buyer_id, awarded_to, stage, title FROM projects WHERE id = $1`,
        [dto.projectId],
      );
      if (!rows.length) throw new NotFoundException('Project not found');
      const project = rows[0];
      const parties = [project.buyer_id, project.awarded_to];
      const pairOk =
        project.awarded_to !== null &&
        parties.includes(reviewer.id) &&
        parties.includes(dto.revieweeId) &&
        reviewer.id !== dto.revieweeId;
      if (!pairOk) throw new ForbiddenException('Only the buyer and the awarded freelancer can review each other');
      if (project.stage !== 'Completed') throw new ConflictException('Reviews open once the project is completed');

      // Lock the reviewee's profile so concurrent reviews recompute the aggregate in turn.
      await client.query(`SELECT 1 FROM expert_profiles WHERE user_id = $1 FOR UPDATE`, [dto.revieweeId]);

      let inserted: { id: string; created_at: Date };
      try {
        const res = await client.query<{ id: string; created_at: Date }>(
          `INSERT INTO reviews (project_id, reviewer_id, reviewee_id, rating, comment)
           VALUES ($1, $2, $3, $4, $5) RETURNING id, created_at`,
          [dto.projectId, reviewer.id, dto.revieweeId, dto.rating, dto.comment ?? ''],
        );
        inserted = res.rows[0];
      } catch (err) {
        if (isUniqueViolation(err)) throw new ConflictException('You have already reviewed this project');
        throw err;
      }

      await client.query(
        `UPDATE expert_profiles p
            SET rating = agg.avg, review_count = agg.n
           FROM (SELECT COALESCE(ROUND(AVG(rating)::numeric, 2), 0) AS avg, COUNT(*)::int AS n
                   FROM reviews WHERE reviewee_id = $1) agg
          WHERE p.user_id = $1`,
        [dto.revieweeId],
      );
      await this.notifications.send(
        dto.revieweeId, `You received a ${dto.rating}-star review for ${project.title}.`, '/platform/profile', client,
      );

      const row: ReviewRow = {
        id: inserted.id,
        rating: dto.rating,
        comment: dto.comment ?? '',
        reviewer_first_name: reviewer.firstName,
        reviewer_last_name: reviewer.lastName,
        project_id: dto.projectId,
        project_title: project.title,
        created_at: inserted.created_at,
      };
      return mapReview(row);
    });
  }
}
