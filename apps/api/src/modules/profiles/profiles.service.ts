import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate, type ValidationError } from 'class-validator';
import { Pool } from 'pg';
import type { User } from '@asteai/types';
import { DB_POOL } from '../../database/database.module';
import { BuyerProfileDto, ExpertProfileDto } from './dto/profile.dto';
import {
  buyerCompletion, BuyerProfileRow, emptyBuyerProfile, emptyExpertProfile, EXPERT_COLUMNS, expertCompletion,
  ExpertProfileRow, mapBuyerProfile, mapExpertProfile, missingForSubmit,
} from './profile.mapper';
import type { BuyerProfile, ExpertProfile, ExpertProfileStatus, MyProfile } from './profile.types';

/** Statuses a freelancer may submit from. */
const SUBMITTABLE: ExpertProfileStatus[] = ['draft', 'rework', 'rejected'];

function flatten(errors: ValidationError[]): string[] {
  return errors.flatMap((e) => [...Object.values(e.constraints ?? {}), ...flatten(e.children ?? [])]);
}

/** Validates a body against a DTO with the same rules as the global ValidationPipe. */
async function validated<T extends object>(cls: new () => T, body: unknown): Promise<T> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new BadRequestException('Expected a JSON object');
  const dto = plainToInstance(cls, body);
  const errors = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  if (errors.length) throw new BadRequestException(flatten(errors));
  return dto;
}

/** Copies only the keys the client actually sent (a partial update). */
function sent<T extends object>(dto: T): Partial<T> {
  return Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * The signed-in user's own profile. Freelancers have an expert profile (with the
 * approval workflow), Buyers a company profile; other roles have neither.
 *
 * Editing an approved profile keeps it approved and listed: a re-review of material
 * changes (headline / summary / skills) is a follow-up, not done here.
 */
@Injectable()
export class ProfilesService {
  constructor(@Inject(DB_POOL) private readonly db: Pool) {}

  async getMine(user: User): Promise<MyProfile> {
    if (user.role === 'Freelancer') return (await this.findExpert(user.id)) ?? emptyExpertProfile(user.id);
    if (user.role === 'Buyer') return (await this.findBuyer(user.id)) ?? emptyBuyerProfile(user.id);
    throw new BadRequestException('Only freelancers and buyers have a profile');
  }

  async updateMine(user: User, body: unknown): Promise<MyProfile> {
    if (user.role === 'Freelancer') return this.saveExpert(user.id, await validated(ExpertProfileDto, body));
    if (user.role === 'Buyer') return this.saveBuyer(user.id, await validated(BuyerProfileDto, body));
    throw new BadRequestException('Only freelancers and buyers have a profile');
  }

  /** Freelancer → admin queue. Allowed from draft, rework or rejected once the basics are filled in. */
  async submit(user: User): Promise<ExpertProfile> {
    if (user.role !== 'Freelancer') throw new BadRequestException('Only freelancers submit a profile for review');
    const profile = await this.findExpert(user.id);
    if (!profile) throw new NotFoundException('Save your profile before submitting it');
    if (!SUBMITTABLE.includes(profile.status)) {
      throw new ConflictException(
        profile.status === 'pending' ? 'Your profile is already waiting for review' : 'Your profile is already approved',
      );
    }
    const missing = missingForSubmit(profile);
    if (missing.length) throw new BadRequestException(`Add ${missing.join(', ')} before submitting`);

    // The status check is repeated in the UPDATE so two clicks can't race past it.
    const { rows } = await this.db.query<ExpertProfileRow>(
      `UPDATE expert_profiles p SET status = 'pending', updated_at = NOW()
        WHERE p.user_id = $1 AND p.status IN ('draft', 'rework', 'rejected')
        RETURNING ${EXPERT_COLUMNS}`,
      [user.id],
    );
    if (!rows.length) throw new ConflictException('Your profile is already waiting for review');
    return mapExpertProfile(rows[0]);
  }

  async findExpert(userId: string): Promise<ExpertProfile | null> {
    const { rows } = await this.db.query<ExpertProfileRow>(
      `SELECT ${EXPERT_COLUMNS} FROM expert_profiles p WHERE p.user_id = $1`,
      [userId],
    );
    return rows.length ? mapExpertProfile(rows[0]) : null;
  }

  private async findBuyer(userId: string): Promise<BuyerProfile | null> {
    const { rows } = await this.db.query<BuyerProfileRow>(
      `SELECT user_id, company_name, industry, website, country, about, completion
         FROM buyer_profiles WHERE user_id = $1`,
      [userId],
    );
    return rows.length ? mapBuyerProfile(rows[0]) : null;
  }

  private async saveExpert(userId: string, dto: ExpertProfileDto): Promise<ExpertProfile> {
    const current = (await this.findExpert(userId)) ?? emptyExpertProfile(userId);
    const next = { ...current, ...sent(dto) };
    const completion = expertCompletion(next);
    const { rows } = await this.db.query<ExpertProfileRow>(
      `INSERT INTO expert_profiles AS p
         (user_id, headline, summary, domains, skills, languages, years_experience, hourly_rate, daily_rate,
          fixed_from, currency, engagement_modes, availability, location, portfolio_url, linkedin_url,
          github_url, completion)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
       ON CONFLICT (user_id) DO UPDATE SET
         headline = EXCLUDED.headline, summary = EXCLUDED.summary, domains = EXCLUDED.domains,
         skills = EXCLUDED.skills, languages = EXCLUDED.languages, years_experience = EXCLUDED.years_experience,
         hourly_rate = EXCLUDED.hourly_rate, daily_rate = EXCLUDED.daily_rate, fixed_from = EXCLUDED.fixed_from,
         currency = EXCLUDED.currency, engagement_modes = EXCLUDED.engagement_modes,
         availability = EXCLUDED.availability, location = EXCLUDED.location,
         portfolio_url = EXCLUDED.portfolio_url, linkedin_url = EXCLUDED.linkedin_url,
         github_url = EXCLUDED.github_url, completion = EXCLUDED.completion, updated_at = NOW()
       RETURNING ${EXPERT_COLUMNS}`,
      [
        userId, next.headline, next.summary, next.domains, next.skills, next.languages, next.yearsExperience,
        next.hourlyRate, next.dailyRate, next.fixedFrom, next.currency, next.engagementModes, next.availability,
        next.location || null, next.portfolioUrl || null, next.linkedinUrl || null, next.githubUrl || null,
        completion,
      ],
    );
    return mapExpertProfile(rows[0]);
  }

  private async saveBuyer(userId: string, dto: BuyerProfileDto): Promise<BuyerProfile> {
    const current = (await this.findBuyer(userId)) ?? emptyBuyerProfile(userId);
    const next = { ...current, ...sent(dto) };
    const { rows } = await this.db.query<BuyerProfileRow>(
      `INSERT INTO buyer_profiles (user_id, company_name, industry, website, country, about, completion)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (user_id) DO UPDATE SET
         company_name = EXCLUDED.company_name, industry = EXCLUDED.industry, website = EXCLUDED.website,
         country = EXCLUDED.country, about = EXCLUDED.about, completion = EXCLUDED.completion, updated_at = NOW()
       RETURNING user_id, company_name, industry, website, country, about, completion`,
      [
        userId, next.companyName || null, next.industry || null, next.website || null, next.country || null,
        next.about || null, buyerCompletion(next),
      ],
    );
    return mapBuyerProfile(rows[0]);
  }
}
