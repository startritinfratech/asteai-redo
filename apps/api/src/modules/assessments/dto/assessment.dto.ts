import { Type } from 'class-transformer';
import {
  IsIn, IsInt, IsObject, IsOptional, IsString, Length, Matches, Max, MaxLength, Min, ValidateNested,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ASSESSMENT_SESSION_STATUSES, type AssessmentSessionStatus } from '@asteai/types';

export class StartAssessmentDto {
  @ApiProperty() @IsString() @MaxLength(32) requisitionId: string;
}

/** Foreground exits and pastes the browser saw since its last answer. */
export class IntegrityEventsDto {
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(50) blur?: number;
  @ApiPropertyOptional() @IsOptional() @IsInt() @Min(0) @Max(50) paste?: number;
}

/**
 * The candidate's answer to the current item. Its shape depends on the item type
 * (`{ choice }`, `{ value }`, `{ guess }`, `{ order }`…); deeptech_ai checks it.
 */
export class AnswerAssessmentDto {
  @ApiProperty() @IsString() @Matches(/^\d{1,6}$/) itemId: string;

  @ApiProperty({ type: Object }) @IsObject() response: Record<string, unknown>;

  @ApiPropertyOptional({ type: IntegrityEventsDto })
  @IsOptional() @ValidateNested() @Type(() => IntegrityEventsDto)
  events?: IntegrityEventsDto;
}

export class ResolveIntegrityDto {
  @ApiProperty() @IsString() @MaxLength(2000) resolution: string;
}

export class ListSessionsQueryDto {
  @ApiPropertyOptional({ enum: ASSESSMENT_SESSION_STATUSES })
  @IsOptional() @IsIn(ASSESSMENT_SESSION_STATUSES) status?: AssessmentSessionStatus;

  @ApiPropertyOptional() @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(200) limit?: number;
}

export class ResetSessionDto {
  @ApiProperty({ example: 'Candidate lost power mid-assessment; confirmed by support ticket #4512' })
  @IsString() @Length(10, 500) reason: string;
}
