import {
  Body, Controller, HttpCode, Inject, Injectable, Logger, Module, Optional, Post, ServiceUnavailableException, UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { AuthGuard } from '@nestjs/passport';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import Anthropic from '@anthropic-ai/sdk';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Pool } from 'pg';
import type { AiExpertSearchResponse, ExpertSearchIntent, User } from '@asteai/types';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { DB_POOL } from '../../database/database.module';
import { CreditsModule } from '../credits/credits.module';
import { CreditsService } from '../credits/credits.service';
import { CARD_COLUMNS, PASSPORT_BADGE_JOIN, PUBLIC_EXPERT_SQL } from '../profiles/expert-search';
import { mapExpertCard, type ExpertCardRow } from '../profiles/profile.mapper';
import { ClaudeIntentParser, INTENT_PARSER, normalizeIntent, type IntentParser } from './intent-parser';
import { rankExperts, type Candidate } from './ranking';

/** credit_costs feature charged for every AI expert search, typed or spoken (15 credits). */
export const AI_SEARCH_FEATURE = 'ai_search';
const MAX_CANDIDATES = 300;

export class AiExpertSearchDto {
  @ApiProperty({ example: 'Senior React dev with fintech experience, under ₹2,000 an hour, available now' })
  @IsString() @MinLength(3) @MaxLength(1000) query!: string;

  /** `voice`: the query is a speech-to-text transcript. */
  @ApiPropertyOptional({ enum: ['text', 'voice'], default: 'text' }) @IsOptional() @IsIn(['text', 'voice']) source?: 'text' | 'voice';

  /** Language of a voice transcript, e.g. hi, ta. */
  @ApiPropertyOptional() @IsOptional() @Matches(/^[a-z]{2}(-[A-Z]{2})?$/) language?: string;

  @ApiPropertyOptional({ minimum: 1, maximum: 50, default: 20 }) @IsOptional() @IsInt() @Min(1) @Max(50) limit?: number;
}

interface CandidateRow extends ExpertCardRow {
  text: string;
  competency_scores: Record<string, string | number> | null;
  overall_score: string | number | null;
}

/** Candidates for one intent: vetted experts whose tags, text or (public) Passport fit at all. */
export function candidateQuery(intent: ExpertSearchIntent): { text: string; values: unknown[] } {
  const terms = [...intent.skills, ...intent.domains].map((t) => t.toLowerCase());
  const ftsText = [intent.summary, ...terms].join(' ');
  return {
    text: `SELECT ${CARD_COLUMNS}, LOWER(COALESCE(p.headline, '') || ' ' || COALESCE(p.summary, '')) AS text,
                  cs.scores AS competency_scores, tp.overall_score
             FROM expert_profiles p
             JOIN user_accounts u ON u.id = p.user_id
             ${PASSPORT_BADGE_JOIN}
             -- Passport scores are used only when the holder made the passport public.
             LEFT JOIN talent_passports tp ON tp.user_id = p.user_id AND tp.visibility = 'public'
             LEFT JOIN LATERAL (
               SELECT jsonb_object_agg(s.competency_key, s.score) AS scores
                 FROM competency_scores s WHERE s.user_id = tp.user_id
             ) cs ON TRUE
            WHERE ${PUBLIC_EXPERT_SQL}
              AND (
                (cardinality($1::text[]) = 0 AND cardinality($3::text[]) = 0)
                OR EXISTS (SELECT 1 FROM unnest(p.skills || p.domains) t, unnest($1::text[]) w
                            WHERE position(w IN lower(t)) > 0 OR position(lower(t) IN w) > 0)
                OR p.search @@ plainto_tsquery('english', $2)
                OR EXISTS (SELECT 1 FROM competency_scores s2
                            WHERE s2.user_id = tp.user_id AND s2.competency_key = ANY($3::text[]) AND s2.score >= 60)
              )
            ORDER BY p.rating DESC, p.review_count DESC, p.user_id
            LIMIT ${MAX_CANDIDATES}`,
    values: [terms, ftsText, intent.competencies],
  };
}

export function toCandidate(r: CandidateRow): Candidate {
  const competencies: Record<string, number> = {};
  for (const [k, v] of Object.entries(r.competency_scores ?? {})) competencies[k] = Number(v);
  return { card: mapExpertCard(r), competencies, overallScore: r.overall_score === null ? null : Number(r.overall_score), text: r.text ?? '' };
}

/**
 * AI & voice expert search. The 15-credit charge is taken with consumeCredits (through
 * runMetered) before the model runs, and refunded automatically if parsing or the search
 * fails. A search that runs but finds nobody keeps the charge.
 */
@Injectable()
export class ExpertSearchService {
  private readonly logger = new Logger(ExpertSearchService.name);

  constructor(
    @Inject(DB_POOL) private readonly db: Pool,
    private readonly credits: CreditsService,
    @Optional() @Inject(INTENT_PARSER) private readonly parser: IntentParser | null,
  ) {}

  async search(user: Pick<User, 'id'>, dto: AiExpertSearchDto): Promise<AiExpertSearchResponse> {
    const parser = this.parser;
    if (!parser) throw new ServiceUnavailableException('AI search is not configured (ANTHROPIC_API_KEY)');
    const query = dto.query.trim();
    return this.credits.runMetered(user.id, AI_SEARCH_FEATURE, async (charge) => {
      const intent = normalizeIntent(await parser.parse({ query, source: dto.source ?? 'text', language: dto.language }), query);
      const q = candidateQuery(intent);
      const { rows } = await this.db.query<CandidateRow>(q.text, q.values);
      const results = rankExperts(rows.map(toCandidate), intent, dto.limit ?? 20);
      return { intent, results, considered: rows.length, credits: { charged: charge.cost, balance: charge.balance } };
    });
  }
}

@ApiTags('experts')
@ApiBearerAuth()
@UseGuards(AuthGuard('jwt'), RolesGuard)
@Controller('experts')
export class ExpertSearchController {
  constructor(private readonly svc: ExpertSearchService) {}

  @Post('ai-search')
  @HttpCode(200)
  @Roles('Buyer', 'Employer', 'Admin')
  @Throttle({ short: { ttl: 60_000, limit: 10 } })
  @ApiOperation({ summary: 'Natural-language or voice expert search, ranked by Passport competencies and domain fit (15 credits)' })
  search(@CurrentUser() user: User, @Body() dto: AiExpertSearchDto) {
    return this.svc.search(user, dto);
  }
}

@Module({
  imports: [CreditsModule],
  controllers: [ExpertSearchController],
  providers: [
    ExpertSearchService,
    {
      provide: INTENT_PARSER,
      inject: [ConfigService],
      useFactory: (config: ConfigService) => {
        const apiKey = config.get<string>('ANTHROPIC_API_KEY');
        if (!apiKey) return null;
        return new ClaudeIntentParser(new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }), config.get<string>('EXPERT_SEARCH_MODEL') ?? 'claude-opus-5-5');
      },
    },
  ],
})
export class ExpertSearchModule {}
