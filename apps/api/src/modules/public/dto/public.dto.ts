import { Transform, Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  EMPLOYMENT_TYPES, JOB_LOCATION_TYPES, PLAN_AUDIENCES,
  type EmploymentType, type JobLocationType, type PlanAudience,
} from '@asteai/types';
import { JOB_PAGE_MAX } from '../job-board';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

export class JobsQueryDto {
  @ApiPropertyOptional() @IsOptional() @Transform(trim) @IsString() @MaxLength(100) q?: string;
  @ApiPropertyOptional({ enum: JOB_LOCATION_TYPES }) @IsOptional() @IsIn(JOB_LOCATION_TYPES as readonly string[]) locationType?: JobLocationType;
  @ApiPropertyOptional({ enum: EMPLOYMENT_TYPES }) @IsOptional() @IsIn(EMPLOYMENT_TYPES as readonly string[]) employmentType?: EmploymentType;
  @ApiPropertyOptional({ maximum: JOB_PAGE_MAX }) @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(JOB_PAGE_MAX) limit?: number;
  @ApiPropertyOptional() @IsOptional() @IsString() @MaxLength(200) cursor?: string;
}

export class PlansQueryDto {
  @ApiPropertyOptional({ enum: PLAN_AUDIENCES }) @IsOptional() @IsIn(PLAN_AUDIENCES as readonly string[]) audience?: PlanAudience;
}
