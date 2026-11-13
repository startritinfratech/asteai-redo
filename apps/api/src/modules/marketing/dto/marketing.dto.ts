import { Transform, Type } from 'class-transformer';
import {
  IsEmail, IsIn, IsObject, IsOptional, IsString, IsUrl, Length, Matches, MaxLength, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  CONTACT_INTENTS, FORM_LIMITS as L, LEAD_STATUSES, LEAD_TIMELINES, LEAD_TRACKS, WORK_MODES,
  type ContactIntent, type LeadStatus, type LeadTimeline, type LeadTrack, type WorkMode,
} from '@asteai/types';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);
const lowerTrim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim().toLowerCase() : value);
/** Spaces, dashes, dots and brackets are formatting; what's left must be E.164. */
const phone = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.replace(/[\s\-().]/g, '') : value);

/** Honeypot + Turnstile token, on every public form. */
export class BotCheckDto {
  @ApiPropertyOptional({ description: 'Honeypot: leave empty.' }) @IsOptional() @IsString() @MaxLength(200) website?: string;
  @ApiPropertyOptional({ description: 'Cloudflare Turnstile response token.' }) @IsOptional() @IsString() @MaxLength(4096) turnstileToken?: string;
}

class UtmDto {
  @IsOptional() @IsString() @MaxLength(100) source?: string;
  @IsOptional() @IsString() @MaxLength(100) medium?: string;
  @IsOptional() @IsString() @MaxLength(100) campaign?: string;
}

export class LeadDto extends BotCheckDto {
  @ApiProperty({ enum: LEAD_TRACKS }) @IsIn(LEAD_TRACKS as readonly string[]) track: LeadTrack;
  @ApiProperty() @Transform(trim) @IsString() @Length(L.roleTitle.min, L.roleTitle.max) roleTitle: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.skills) skills?: string;
  @ApiProperty({ enum: WORK_MODES }) @IsIn(WORK_MODES as readonly string[]) workMode: WorkMode;
  @ApiProperty({ enum: LEAD_TIMELINES }) @IsIn(LEAD_TIMELINES as readonly string[]) timeline: LeadTimeline;
  @ApiProperty() @Transform(trim) @IsString() @Length(L.company.min, L.company.max) company: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(L.name.min, L.name.max) contactName: string;
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(L.email) email: string;
  @ApiProperty({ example: '+919876543210' })
  @Transform(phone) @IsString() @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in international format, e.g. +919876543210' })
  phone: string;
  @ApiPropertyOptional() @IsOptional() @IsObject() @ValidateNested() @Type(() => UtmDto) utm?: UtmDto;
}

export class ContactDto extends BotCheckDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(L.name.min, L.name.max) name: string;
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(L.email) email: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(L.subject.min, L.subject.max) subject: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(L.message.min, L.message.max) message: string;
  @ApiPropertyOptional({ enum: CONTACT_INTENTS }) @IsOptional() @IsIn(CONTACT_INTENTS as readonly string[]) intent?: ContactIntent;
}

export class NewsletterDto extends BotCheckDto {
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(L.email) email: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(40) source?: string;
}

export class TokenDto {
  @ApiProperty() @IsString() @Length(20, 100) token: string;
}

export class CareerApplicationDto extends BotCheckDto {
  @ApiProperty() @Transform(trim) @IsString() @Length(1, 80) roleSlug: string;
  @ApiProperty() @Transform(trim) @IsString() @Length(L.name.min, L.name.max) fullName: string;
  @ApiProperty() @Transform(lowerTrim) @IsEmail() @MaxLength(L.email) email: string;
  @ApiPropertyOptional()
  @IsOptional() @Transform(trim) @IsUrl({ protocols: ['https', 'http'], require_protocol: true }) @MaxLength(L.profileUrl)
  profileUrl?: string;
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(L.careerMessage) message?: string;
}

export class LeadsQueryDto {
  @ApiPropertyOptional({ enum: LEAD_STATUSES }) @IsOptional() @IsIn(LEAD_STATUSES as readonly string[]) status?: LeadStatus;
  @ApiPropertyOptional() @IsOptional() @IsString() page?: string;
  @ApiPropertyOptional() @IsOptional() @IsString() pageSize?: string;
}

export class SetLeadStatusDto {
  @ApiProperty({ enum: LEAD_STATUSES }) @IsIn(LEAD_STATUSES as readonly string[]) status: LeadStatus;
}
