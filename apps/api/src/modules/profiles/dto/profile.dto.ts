import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsInt, IsNumber, IsOptional, IsString, IsUrl, IsUUID,
  Length, Matches, Max, MaxLength, Min, ValidateIf,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  AVAILABILITIES, ENGAGEMENT_MODES, EXPERT_PROFILE_STATUSES, EXPERT_REVIEW_DECISIONS, EXPERT_SORTS,
  PROFILE_LIMITS as L,
  type Availability, type EngagementMode, type ExpertProfileStatus, type ExpertReviewDecision, type ExpertSort,
} from '../profile.types';

/** https only, with a real host; '' clears the field. */
const HTTPS_URL = { protocols: ['https'], require_protocol: true, require_tld: true, allow_underscores: false };

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
/** Trims every entry and drops empty ones, so ['  ', 'Rust '] becomes ['Rust']. */
const tags = ({ value }: { value: unknown }) =>
  Array.isArray(value)
    ? value.map((v) => (typeof v === 'string' ? v.trim().replace(/\s+/g, ' ') : v)).filter((v) => v !== '')
    : value;

/** PUT /profiles/me as a Freelancer. Partial: only the fields sent change. */
export class ExpertProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.headline) headline?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.summary) summary?: string;

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(tags) @IsArray() @ArrayMaxSize(L.domains) @ArrayUnique((v: string) => v.toLowerCase())
  @IsString({ each: true }) @MaxLength(L.tag, { each: true })
  domains?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(tags) @IsArray() @ArrayMaxSize(L.skills) @ArrayUnique((v: string) => v.toLowerCase())
  @IsString({ each: true }) @MaxLength(L.tag, { each: true })
  skills?: string[];

  @ApiPropertyOptional({ type: [String] })
  @IsOptional() @Transform(tags) @IsArray() @ArrayMaxSize(L.languages) @ArrayUnique((v: string) => v.toLowerCase())
  @IsString({ each: true }) @MaxLength(L.tag, { each: true })
  languages?: string[];

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsInt() @Min(0) @Max(L.yearsExperience)
  yearsExperience?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(L.rate)
  hourlyRate?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(L.rate)
  dailyRate?: number | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional() @ValidateIf((_o, v) => v !== null) @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(L.rate)
  fixedFrom?: number | null;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional() @Transform(({ value }) => (typeof value === 'string' ? value.trim().toUpperCase() : value))
  @Matches(/^[A-Z]{3}$/, { message: 'currency must be a 3-letter ISO code' })
  currency?: string;

  @ApiPropertyOptional({ enum: ENGAGEMENT_MODES, isArray: true })
  @IsOptional() @IsArray() @ArrayUnique() @IsIn(ENGAGEMENT_MODES, { each: true })
  engagementModes?: EngagementMode[];

  @ApiPropertyOptional({ enum: AVAILABILITIES })
  @IsOptional() @IsIn(AVAILABILITIES) availability?: Availability;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.location) location?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(L.url)
  @ValidateIf((_o, v) => v !== '') @IsUrl(HTTPS_URL, { message: 'portfolioUrl must be an https:// URL' })
  portfolioUrl?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(L.url)
  @ValidateIf((_o, v) => v !== '') @IsUrl(HTTPS_URL, { message: 'linkedinUrl must be an https:// URL' })
  linkedinUrl?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(L.url)
  @ValidateIf((_o, v) => v !== '') @IsUrl(HTTPS_URL, { message: 'githubUrl must be an https:// URL' })
  githubUrl?: string;
}

/** PUT /profiles/me as a Buyer. */
export class BuyerProfileDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.company) companyName?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(120) industry?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsString() @MaxLength(L.url)
  @ValidateIf((_o, v) => v !== '') @IsUrl(HTTPS_URL, { message: 'website must be an https:// URL' })
  website?: string;

  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(80) country?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.about) about?: string;
}

/** GET /experts query string. Every value is bound as a parameter, never interpolated. */
export class ListExpertsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(200) q?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.tag) domain?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.tag) skill?: string;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(L.rate) minRate?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsNumber() @Min(0) @Max(L.rate) maxRate?: number;

  @ApiPropertyOptional({ enum: AVAILABILITIES }) @IsOptional() @IsIn(AVAILABILITIES) availability?: Availability;
  @ApiPropertyOptional({ enum: ENGAGEMENT_MODES }) @IsOptional() @IsIn(ENGAGEMENT_MODES) engagement?: EngagementMode;
  @ApiPropertyOptional({ enum: EXPERT_SORTS }) @IsOptional() @IsIn(EXPERT_SORTS) sort?: ExpertSort;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(1000) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) pageSize?: number;
}

export class AdminExpertsQueryDto {
  @ApiPropertyOptional({ enum: EXPERT_PROFILE_STATUSES })
  @IsOptional() @IsIn(EXPERT_PROFILE_STATUSES) status?: ExpertProfileStatus;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) page?: number;
  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100) pageSize?: number;
}

export class SetExpertStatusDto {
  @ApiProperty({ enum: EXPERT_REVIEW_DECISIONS }) @IsIn(EXPERT_REVIEW_DECISIONS) status: ExpertReviewDecision;

  /** Shown to the freelancer. Required for rejected / rework (checked in the service). */
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.adminNote) note?: string;
}

export class CreateReviewDto {
  @ApiProperty() @IsUUID() revieweeId: string;
  @ApiProperty() @IsString() @Length(1, 32) projectId: string;
  @ApiProperty({ minimum: 1, maximum: 5 }) @IsInt() @Min(1) @Max(5) rating: number;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.reviewComment) comment?: string;
}
